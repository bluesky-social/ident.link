use atproto_identity::{Did, Directory, Error as DirectoryError, Identity};
use egress::{Client, Error as EgressError};
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use url::Url;

const COLLECTION: &str = "link.ident.endorsement";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ApiError {
    InvalidDid,
    DidNotFound,
    UpstreamUnavailable,
}

impl ApiError {
    pub fn status(&self) -> u16 {
        match self {
            Self::InvalidDid => 400,
            Self::DidNotFound => 404,
            Self::UpstreamUnavailable => 503,
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::InvalidDid => "InvalidDid",
            Self::DidNotFound => "DidNotFound",
            Self::UpstreamUnavailable => "UpstreamUnavailable",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            Self::InvalidDid => "The principal and agent must be valid atproto DIDs.",
            Self::DidNotFound => "A DID could not be resolved.",
            Self::UpstreamUnavailable => "Could not check the relationship; please try again.",
        }
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Endorsement {
    pub uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cid: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PairResult {
    pub principal: String,
    pub agent: String,
    pub confirmed: bool,
    pub declared: bool,
    pub endorsement: Option<Endorsement>,
    pub checked_at: String,
}

pub struct UpstreamResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

/// The deterministic pair-check logic depends on this small boundary rather
/// than on a particular async runtime or HTTP implementation.
#[allow(async_fn_in_trait)]
pub trait PairSource {
    async fn lookup_identity(&self, did: &Did) -> Result<Arc<Identity>, ApiError>;
    async fn get_record(&self, url: Url) -> Result<UpstreamResponse, ApiError>;
}

/// Production source: every identity and PDS request goes through rust-tools.
pub struct RustToolsSource {
    directory: Directory,
    client: Client,
}

impl RustToolsSource {
    pub fn new(directory: Directory, client: Client) -> Self {
        Self { directory, client }
    }
}

impl PairSource for RustToolsSource {
    async fn lookup_identity(&self, did: &Did) -> Result<Arc<Identity>, ApiError> {
        self.directory
            .lookup_did(did)
            .await
            .map_err(map_identity_error)
    }

    async fn get_record(&self, url: Url) -> Result<UpstreamResponse, ApiError> {
        let response = self
            .client
            .get_response(url)
            .await
            .map_err(|_| ApiError::UpstreamUnavailable)?;
        Ok(UpstreamResponse {
            status: response.status,
            body: response.body,
        })
    }
}

fn map_identity_error(error: DirectoryError) -> ApiError {
    match error {
        DirectoryError::Egress(EgressError::Status { status: 404, .. }) => ApiError::DidNotFound,
        _ => ApiError::UpstreamUnavailable,
    }
}

/// URL path segments may percent-encode DID punctuation (for example, %3A).
pub fn decode_did_segment(segment: &str) -> Result<String, ApiError> {
    percent_encoding::percent_decode_str(segment)
        .decode_utf8()
        .map(|did| did.into_owned())
        .map_err(|_| ApiError::InvalidDid)
}

fn parse_pair(principal: &str, agent: &str) -> Result<(Did, Did), ApiError> {
    // Atproto DIDs are bounded, and the agent DID is also a record key.
    if principal.len() > 2048 || agent.len() > 512 {
        return Err(ApiError::InvalidDid);
    }
    let principal = Did::parse(principal).map_err(|_| ApiError::InvalidDid)?;
    let agent = Did::parse(agent).map_err(|_| ApiError::InvalidDid)?;
    Ok((principal, agent))
}

pub fn validate_pair(principal: &str, agent: &str) -> Result<(), ApiError> {
    parse_pair(principal, agent).map(|_| ())
}

fn record_url(identity: &Identity, principal: &Did, agent: &Did) -> Result<Url, ApiError> {
    let endpoint = identity
        .pds_endpoint()
        .ok_or(ApiError::UpstreamUnavailable)?;
    let mut url = Url::parse(endpoint).map_err(|_| ApiError::UpstreamUnavailable)?;
    if url.query().is_some() || url.fragment().is_some() {
        return Err(ApiError::UpstreamUnavailable);
    }
    // Preserve any base path rather than replacing it with an absolute path.
    let path = format!(
        "{}/xrpc/com.atproto.repo.getRecord",
        url.path().trim_end_matches('/')
    );
    url.set_path(&path);
    url.query_pairs_mut()
        .append_pair("repo", principal.as_str())
        .append_pair("collection", COLLECTION)
        .append_pair("rkey", agent.as_str());
    Ok(url)
}

pub async fn check_pair<S: PairSource>(
    source: &S,
    principal: &str,
    agent: &str,
    checked_at: String,
) -> Result<PairResult, ApiError> {
    let (principal, agent) = parse_pair(principal, agent)?;
    let (principal_identity, agent_identity) = futures::join!(
        source.lookup_identity(&principal),
        source.lookup_identity(&agent)
    );
    let principal_identity = principal_identity?;
    let agent_identity = agent_identity?;

    let declaration = format!("https://ident.link/agent-of/{principal}");
    let declared = agent_identity
        .also_known_as
        .iter()
        .any(|entry| entry == &declaration);

    let url = record_url(&principal_identity, &principal, &agent)?;
    let response = source.get_record(url).await?;
    let (endorsement, record_matches) = if matches!(response.status, 400 | 404) {
        let value: Value =
            serde_json::from_slice(&response.body).map_err(|_| ApiError::UpstreamUnavailable)?;
        if value.get("error").and_then(Value::as_str) == Some("RecordNotFound") {
            (None, false)
        } else {
            return Err(ApiError::UpstreamUnavailable);
        }
    } else if response.status == 200 {
        let value: Value =
            serde_json::from_slice(&response.body).map_err(|_| ApiError::UpstreamUnavailable)?;
        let expected_uri = format!("at://{principal}/{COLLECTION}/{agent}");
        if value.get("uri").and_then(Value::as_str) != Some(expected_uri.as_str()) {
            return Err(ApiError::UpstreamUnavailable);
        }
        let record = value
            .get("value")
            .and_then(Value::as_object)
            .ok_or(ApiError::UpstreamUnavailable)?;
        let matches = record.get("agent").and_then(Value::as_str) == Some(agent.as_str())
            && record.get("$type").and_then(Value::as_str) == Some(COLLECTION);
        let cid = match value.get("cid") {
            Some(Value::String(cid)) => Some(cid.clone()),
            None => None,
            _ => return Err(ApiError::UpstreamUnavailable),
        };
        (
            Some(Endorsement {
                uri: expected_uri,
                cid,
            }),
            matches,
        )
    } else {
        return Err(ApiError::UpstreamUnavailable);
    };

    Ok(PairResult {
        principal: principal.to_string(),
        agent: agent.to_string(),
        confirmed: declared && record_matches,
        declared,
        endorsement,
        checked_at,
    })
}

#[derive(Debug, PartialEq, Eq)]
pub enum Representation {
    Html,
    Json,
    NotAcceptable,
}

/// Explicit media types take precedence over wildcards, including for q=0.
/// If the quality and specificity tie, JSON wins (including for */*).
pub fn negotiate(accept: Option<&str>) -> Representation {
    let Some(accept) = accept else {
        return Representation::Json;
    };
    let quality = |target: &str| -> (f32, u8) {
        let (target_type, _) = target.split_once('/').unwrap();
        let mut best: Option<(u8, f32)> = None;
        for part in accept.split(',') {
            let mut fields = part.trim().split(';');
            let media = fields.next().unwrap_or("").trim();
            let rank = if media.eq_ignore_ascii_case(target) {
                2
            } else if media.eq_ignore_ascii_case(&format!("{target_type}/*")) {
                1
            } else if media == "*/*" {
                0
            } else {
                continue;
            };
            let mut q = 1.0f32;
            for field in fields {
                if let Some((key, value)) = field.trim().split_once('=') {
                    if key.trim().eq_ignore_ascii_case("q") {
                        q = value.trim().parse().unwrap_or(0.0);
                        if !q.is_finite() || !(0.0..=1.0).contains(&q) {
                            q = 0.0;
                        }
                    }
                }
            }
            if best
                .is_none_or(|(old_rank, old_q)| rank > old_rank || (rank == old_rank && q > old_q))
            {
                best = Some((rank, q));
            }
        }
        best.map_or((0.0, 0), |(rank, q)| (q, rank))
    };
    let html = quality("text/html");
    let json = quality("application/json");
    if html.0 == 0.0 && json.0 == 0.0 {
        Representation::NotAcceptable
    } else if html.0 > json.0 || (html.0 == json.0 && html.1 > json.1) {
        Representation::Html
    } else {
        Representation::Json
    }
}

#[cfg(target_arch = "wasm32")]
mod worker_entry;

#[cfg(test)]
mod tests;
