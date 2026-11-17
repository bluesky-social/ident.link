use super::*;
use atproto_identity::ServiceEndpoint;
use futures::executor::block_on;
use serde_json::json;
use std::cell::RefCell;
use std::collections::HashMap;

const PRINCIPAL: &str = "did:plc:ewvi7nxzyoun6zhxrhs64oiz";
const AGENT: &str = "did:plc:ewvi7nxzyoun6zhxrhs64oia";

fn identity(did: &str, also_known_as: Vec<String>, endpoint: Option<&str>) -> Arc<Identity> {
    let mut services = HashMap::new();
    if let Some(endpoint) = endpoint {
        services.insert(
            "#atproto_pds".to_owned(),
            ServiceEndpoint {
                id: "#atproto_pds".to_owned(),
                service_type: "AtprotoPersonalDataServer".to_owned(),
                endpoint: endpoint.to_owned(),
            },
        );
    }
    Arc::new(Identity {
        did: Did::parse(did).unwrap(),
        handle: None,
        also_known_as,
        services,
    })
}

struct Mock {
    principal: Result<Arc<Identity>, ApiError>,
    agent: Result<Arc<Identity>, ApiError>,
    record_status: u16,
    record_body: Vec<u8>,
    record_error: Option<ApiError>,
    lookups: RefCell<Vec<String>>,
    requests: RefCell<Vec<Url>>,
}

impl Mock {
    fn new() -> Self {
        Self {
            principal: Ok(identity(
                PRINCIPAL,
                Vec::new(),
                Some("https://pds.example.net"),
            )),
            agent: Ok(identity(
                AGENT,
                vec![format!("https://ident.link/agent-of/{PRINCIPAL}")],
                None,
            )),
            record_status: 200,
            record_body: serde_json::to_vec(&json!({
                "uri": format!("at://{PRINCIPAL}/{COLLECTION}/{AGENT}"),
                "cid": "bafytest",
                "value": { "$type": COLLECTION, "agent": AGENT }
            }))
            .unwrap(),
            record_error: None,
            lookups: RefCell::new(Vec::new()),
            requests: RefCell::new(Vec::new()),
        }
    }

    fn set_record(&mut self, status: u16, body: Value) {
        self.record_status = status;
        self.record_body = serde_json::to_vec(&body).unwrap();
        self.record_error = None;
    }

    fn check(&self) -> Result<PairResult, ApiError> {
        block_on(check_pair(
            self,
            PRINCIPAL,
            AGENT,
            "2026-11-13T00:00:00Z".into(),
        ))
    }
}

impl PairSource for Mock {
    async fn lookup_identity(&self, did: &Did) -> Result<Arc<Identity>, ApiError> {
        self.lookups.borrow_mut().push(did.to_string());
        let result = if did.as_str() == PRINCIPAL {
            &self.principal
        } else if did.as_str() == AGENT {
            &self.agent
        } else {
            panic!("unexpected DID: {did}")
        };
        match result {
            Ok(identity) => Ok(identity.clone()),
            Err(error) => Err(error.clone()),
        }
    }

    async fn get_record(&self, url: Url) -> Result<UpstreamResponse, ApiError> {
        assert_eq!(url.host_str(), Some("pds.example.net"));
        let query: Vec<_> = url.query_pairs().collect();
        assert!(query.iter().any(|(k, v)| k == "repo" && v == PRINCIPAL));
        assert!(query
            .iter()
            .any(|(k, v)| k == "collection" && v == COLLECTION));
        assert!(query.iter().any(|(k, v)| k == "rkey" && v == AGENT));
        self.requests.borrow_mut().push(url);
        if let Some(error) = &self.record_error {
            return Err(error.clone());
        }
        Ok(UpstreamResponse {
            status: self.record_status,
            body: self.record_body.clone(),
        })
    }
}

#[test]
fn confirms_only_matching_declaration_and_record() {
    let mock = Mock::new();
    let result = mock.check().unwrap();
    assert!(result.confirmed);
    assert!(result.declared);
    assert_eq!(result.endorsement.unwrap().cid.as_deref(), Some("bafytest"));
    assert_eq!(result.checked_at, "2026-11-13T00:00:00Z");
    assert_eq!(mock.requests.borrow().len(), 1);
    assert_eq!(mock.lookups.borrow().len(), 2);
    assert!(mock.lookups.borrow().contains(&PRINCIPAL.to_owned()));
    assert!(mock.lookups.borrow().contains(&AGENT.to_owned()));
}

#[test]
fn handles_missing_and_inexact_declaration() {
    for aka in [
        vec![],
        vec![format!("https://ident.link/agent-of/{PRINCIPAL}?x=1")],
        vec![format!(
            "https://ident.link/agent-of/{PRINCIPAL}/endorses/{AGENT}"
        )],
    ] {
        let mut mock = Mock::new();
        mock.agent = Ok(identity(AGENT, aka, None));
        let result = mock.check().unwrap();
        assert!(!result.confirmed);
        assert!(!result.declared);
        assert!(result.endorsement.is_some());
    }
}

#[test]
fn handles_record_not_found_and_wrong_agent() {
    let mut mock = Mock::new();
    mock.set_record(
        400,
        json!({"error":"RecordNotFound", "message":"not found"}),
    );
    let result = mock.check().unwrap();
    assert!(result.declared);
    assert!(!result.confirmed);
    assert!(result.endorsement.is_none());
    mock.record_status = 404;
    assert!(mock.check().unwrap().endorsement.is_none());

    let mut mock = Mock::new();
    let mut body: Value = serde_json::from_slice(&mock.record_body).unwrap();
    body["value"]["agent"] = json!(PRINCIPAL);
    mock.set_record(200, body);
    let result = mock.check().unwrap();
    assert!(!result.confirmed);
    assert!(result.endorsement.is_some());

    let mut mock = Mock::new();
    let mut body: Value = serde_json::from_slice(&mock.record_body).unwrap();
    body["value"]["$type"] = json!("other.record");
    mock.set_record(200, body);
    assert!(!mock.check().unwrap().confirmed);
}

#[test]
fn failures_are_not_negative_results() {
    let mut mock = Mock::new();
    mock.principal = Err(ApiError::UpstreamUnavailable);
    assert_eq!(mock.check().unwrap_err(), ApiError::UpstreamUnavailable);

    let mut mock = Mock::new();
    mock.record_error = Some(ApiError::UpstreamUnavailable);
    assert_eq!(mock.check().unwrap_err(), ApiError::UpstreamUnavailable);

    let mut mock = Mock::new();
    mock.set_record(503, json!({"error":"RecordNotFound"}));
    assert_eq!(mock.check().unwrap_err(), ApiError::UpstreamUnavailable);
    mock.set_record(400, json!({"error":"RepoDeactivated"}));
    assert_eq!(mock.check().unwrap_err(), ApiError::UpstreamUnavailable);
    mock.set_record(404, json!({"error":"InvalidRequest"}));
    assert_eq!(mock.check().unwrap_err(), ApiError::UpstreamUnavailable);

    let mut mock = Mock::new();
    mock.principal = Err(ApiError::DidNotFound);
    assert_eq!(mock.check().unwrap_err(), ApiError::DidNotFound);
    let mut mock = Mock::new();
    mock.agent = Err(ApiError::DidNotFound);
    assert_eq!(mock.check().unwrap_err(), ApiError::DidNotFound);

    let mut mock = Mock::new();
    let mut body: Value = serde_json::from_slice(&mock.record_body).unwrap();
    body["uri"] = json!("at://someone/else");
    mock.set_record(200, body);
    assert_eq!(mock.check().unwrap_err(), ApiError::UpstreamUnavailable);
}

#[test]
fn only_directory_404_means_missing_did() {
    for status in [410, 500, 503] {
        let error = DirectoryError::Egress(EgressError::Status {
            status,
            url: "https://plc.directory/did:plc:missing".to_owned(),
        });
        assert_eq!(map_identity_error(error), ApiError::UpstreamUnavailable);
    }
    let error = DirectoryError::Egress(EgressError::Status {
        status: 404,
        url: "https://plc.directory/did:plc:missing".to_owned(),
    });
    assert_eq!(map_identity_error(error), ApiError::DidNotFound);
}

#[test]
fn validates_dids_with_atproto_identity() {
    assert!(validate_pair(PRINCIPAL, AGENT).is_ok());
    assert_eq!(
        decode_did_segment("did%3Aplc%3Aewvi7nxzyoun6zhxrhs64oiz").unwrap(),
        PRINCIPAL
    );
    assert!(decode_did_segment("did%FFplc").is_err());
    assert!(validate_pair(&decode_did_segment("did%3Aplc%3Afoo%2Fbar").unwrap(), AGENT).is_err());
    assert!(validate_pair("did:web:example.com", AGENT).is_ok());
    assert!(validate_pair("did:plc:short", AGENT).is_ok());
    assert!(validate_pair(PRINCIPAL, "did:example:alice").is_err());
    assert!(validate_pair("not-a-did", AGENT).is_err());
    let long_agent = format!("did:web:{}.example", "a".repeat(510));
    assert_eq!(
        validate_pair(PRINCIPAL, &long_agent),
        Err(ApiError::InvalidDid)
    );
    let long_principal = format!("did:web:{}.example", "a".repeat(2048));
    assert_eq!(
        validate_pair(&long_principal, AGENT),
        Err(ApiError::InvalidDid)
    );
}

#[test]
fn builds_record_urls_and_rejects_unusable_endpoints() {
    let mut mock = Mock::new();
    mock.principal = Ok(identity(
        PRINCIPAL,
        Vec::new(),
        Some("https://pds.example.net/base/"),
    ));
    mock.check().unwrap();
    assert_eq!(
        mock.requests.borrow()[0].path(),
        "/base/xrpc/com.atproto.repo.getRecord"
    );

    for endpoint in [None, Some("not a url"), Some("https://pds.example.net?x=1")] {
        let mut mock = Mock::new();
        mock.principal = Ok(identity(PRINCIPAL, Vec::new(), endpoint));
        assert_eq!(mock.check().unwrap_err(), ApiError::UpstreamUnavailable);
    }
}

#[test]
fn negotiates_html_json_and_wildcards() {
    use Representation::*;
    assert_eq!(negotiate(None), Json);
    assert_eq!(negotiate(Some("*/*")), Json);
    assert_eq!(negotiate(Some("text/html, */*")), Html);
    assert_eq!(negotiate(Some("application/json")), Json);
    assert_eq!(
        negotiate(Some(
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        )),
        Html
    );
    assert_eq!(negotiate(Some("text/html;q=0, */*;q=1")), Json);
    assert_eq!(
        negotiate(Some("application/json;q=0, text/html;q=0")),
        NotAcceptable
    );
    assert_eq!(
        negotiate(Some("text/html;q=0.8, application/json;q=0.9")),
        Json
    );
}
