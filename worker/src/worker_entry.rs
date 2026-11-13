use super::*;
use atproto_identity::DirectoryConfig;
use egress::ClientConfig;
use std::time::Duration;
use worker::{event, Context, Env, Method, Request, Response, Result};

const MAX_RESPONSE_BYTES: u64 = 512 * 1024;
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(8);

fn json_response(value: &impl Serialize, status: u16) -> Result<Response> {
    let mut response = Response::from_json(value)?.with_status(status);
    response.headers_mut().set("Vary", "Accept")?;
    response
        .headers_mut()
        .set("Access-Control-Allow-Origin", "*")?;
    // Browser caches may retain successful checks briefly. Shared edge caches
    // must not mix the JSON and HTML variants for the same URL.
    response.headers_mut().set(
        "Cache-Control",
        if status == 200 {
            "private, max-age=30"
        } else {
            "no-store"
        },
    )?;
    Ok(response)
}

fn error_response(error: ApiError) -> Result<Response> {
    json_response(
        &serde_json::json!({"error": error.name(), "message": error.message()}),
        error.status(),
    )
}

async fn html_response(req: &Request, env: &Env) -> Result<Response> {
    let mut url = req.url()?;
    url.set_path("/agent-of-pair/");
    url.set_query(None);
    let mut asset = env.service("ASSETS")?.fetch(url.to_string(), None).await?;
    if asset.status_code() != 200 {
        return Response::error("Page unavailable", 503);
    }
    // Rebuild the response with mutable headers; the asset response can have
    // immutable headers. The document is a generic shell, not user data.
    let mut response = Response::from_html(asset.text().await?)?;
    response.headers_mut().set("Vary", "Accept")?;
    response.headers_mut().set("Cache-Control", "no-store")?;
    Ok(response)
}

#[event(fetch)]
pub async fn main(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let path = req.path();
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() != 5 || !parts[0].is_empty() || parts[1] != "agent-of" || parts[3] != "endorses"
    {
        return env.service("ASSETS")?.fetch_request(req).await;
    }
    if req.method() != Method::Get {
        let mut response = json_response(
            &serde_json::json!({"error":"MethodNotAllowed","message":"Only GET is supported."}),
            405,
        )?;
        response.headers_mut().set("Allow", "GET")?;
        return Ok(response);
    }
    let principal = match decode_did_segment(parts[2]) {
        Ok(did) => did,
        Err(error) => return error_response(error),
    };
    let agent = match decode_did_segment(parts[4]) {
        Ok(did) => did,
        Err(error) => return error_response(error),
    };
    if let Err(error) = validate_pair(&principal, &agent) {
        return error_response(error);
    }
    match negotiate(req.headers().get("Accept")?.as_deref()) {
        Representation::Html => html_response(&req, &env).await,
        Representation::NotAcceptable => json_response(
            &serde_json::json!({"error":"NotAcceptable","message":"Available formats are HTML and JSON."}),
            406,
        ),
        Representation::Json => {
            let client = match Client::new_cloudflare(ClientConfig {
                timeout: UPSTREAM_TIMEOUT,
                max_response_bytes: MAX_RESPONSE_BYTES,
                ..ClientConfig::default()
            }) {
                Ok(client) => client,
                Err(_) => return error_response(ApiError::UpstreamUnavailable),
            };
            let directory = Directory::with_client(DirectoryConfig::default(), client.clone());
            let source = RustToolsSource::new(directory, client);
            match check_pair(&source, &principal, &agent, String::new()).await {
                Ok(mut result) => {
                    result.checked_at = js_sys::Date::new_0().to_iso_string().into();
                    json_response(&result, 200)
                }
                Err(error) => error_response(error),
            }
        }
    }
}
