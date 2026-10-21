use serde_json::Value;
use std::collections::HashSet;

pub fn validate_catalog(catalog: &Value) -> Result<(), String> {
    let object = catalog.as_object().ok_or("catalog must be an object")?;
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err("catalog schemaVersion must be 1".into());
    }
    let apps = object
        .get("apps")
        .and_then(Value::as_array)
        .ok_or("catalog apps must be an array")?;
    let mut app_ids = HashSet::new();
    for app in apps {
        let id = app
            .get("id")
            .and_then(Value::as_str)
            .ok_or("each catalog app needs an id")?;
        if id.is_empty() || id.len() > 128 || !app_ids.insert(id) {
            return Err("catalog app IDs must be non-empty, bounded, and unique".into());
        }
        if app
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| !name.trim().is_empty())
            .is_none()
        {
            return Err("each catalog app needs a name".into());
        }
        let releases = app
            .get("releases")
            .and_then(Value::as_array)
            .filter(|list| !list.is_empty())
            .ok_or("each catalog app needs at least one release")?;
        let mut release_ids = HashSet::new();
        for release in releases {
            let release_id = release
                .get("id")
                .and_then(Value::as_str)
                .ok_or("each catalog release needs an id")?;
            if !release_id.starts_with(&format!("{id}@")) || !release_ids.insert(release_id) {
                return Err("release IDs must be unique and begin with the owning app ID".into());
            }
            let manifest = release
                .get("manifestUrl")
                .and_then(Value::as_str)
                .ok_or("each release needs a manifestUrl")?;
            if !manifest.starts_with("https://") && !is_loopback_http_manifest(manifest) {
                return Err("microfrontend manifests must use HTTPS".into());
            }
            if release
                .get("remoteName")
                .and_then(Value::as_str)
                .filter(|name| !name.is_empty() && name.len() <= 64)
                .is_none()
            {
                return Err("each release needs a bounded remoteName".into());
            }
            if release
                .get("exposedModule")
                .and_then(Value::as_str)
                .filter(|path| path.starts_with("./") && path.len() <= 128)
                .is_none()
            {
                return Err("each release needs a relative exposedModule".into());
            }
        }
    }
    Ok(())
}

fn is_loopback_http_manifest(manifest: &str) -> bool {
    let Some(rest) = manifest.strip_prefix("http://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.contains('@') {
        return false;
    }
    let hostname = if authority.starts_with('[') {
        authority.split_once(']').and_then(|(host, suffix)| {
            let port_is_valid = suffix.is_empty()
                || suffix.strip_prefix(':').is_some_and(|port| !port.is_empty() && port.bytes().all(|byte| byte.is_ascii_digit()));
            port_is_valid.then(|| format!("{host}]"))
        })
    } else {
        let (host, port_is_valid) = match authority.split_once(':') {
            Some((host, port)) => (host, !port.is_empty() && port.bytes().all(|byte| byte.is_ascii_digit())),
            None => (authority, true),
        };
        port_is_valid.then(|| host.to_ascii_lowercase())
    };
    matches!(hostname.as_deref(), Some("localhost" | "127.0.0.1" | "[::1]"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEFAULT_CATALOG: &str = include_str!("../../../workspace-config/catalog.json");

    fn app() -> Value {
        serde_json::json!({"id":"orders","name":"Orders","releases":[{"id":"orders@1.0.0","manifestUrl":"https://example.com/mf.json","remoteName":"orders","exposedModule":"./mount"}]})
    }

    #[test]
    fn validates_checked_in_microfrontend_catalog() {
        let catalog: Value = serde_json::from_str(DEFAULT_CATALOG).unwrap();
        assert_eq!(validate_catalog(&catalog), Ok(()));
    }

    #[test]
    fn rejects_invalid_catalog_and_application_identity() {
        assert_eq!(
            validate_catalog(&Value::Null),
            Err("catalog must be an object".into())
        );
        assert_eq!(
            validate_catalog(&serde_json::json!({"schemaVersion":2,"apps":[]})),
            Err("catalog schemaVersion must be 1".into())
        );
        assert_eq!(
            validate_catalog(&serde_json::json!({"schemaVersion":1})),
            Err("catalog apps must be an array".into())
        );
        assert_eq!(
            validate_catalog(&serde_json::json!({"schemaVersion":1,"apps":[{}]})),
            Err("each catalog app needs an id".into())
        );
        let mut invalid = app();
        invalid["id"] = "".into();
        assert!(
            validate_catalog(&serde_json::json!({"schemaVersion":1,"apps":[invalid]}))
                .unwrap_err()
                .contains("IDs")
        );
        let mut invalid = app();
        invalid["name"] = " ".into();
        assert!(
            validate_catalog(&serde_json::json!({"schemaVersion":1,"apps":[invalid]}))
                .unwrap_err()
                .contains("name")
        );
        let mut invalid = app();
        invalid["releases"] = serde_json::json!([]);
        assert!(
            validate_catalog(&serde_json::json!({"schemaVersion":1,"apps":[invalid]}))
                .unwrap_err()
                .contains("at least one release")
        );
        let duplicate = app();
        assert!(
            validate_catalog(
                &serde_json::json!({"schemaVersion":1,"apps":[duplicate.clone(),duplicate]})
            )
            .unwrap_err()
            .contains("unique")
        );
    }

    #[test]
    fn rejects_invalid_release_metadata() {
        let mut invalid = app();
        invalid["releases"][0]["id"] = "other@1.0.0".into();
        assert!(
            validate_catalog(&serde_json::json!({"schemaVersion":1,"apps":[invalid]}))
                .unwrap_err()
                .contains("owning app ID")
        );
        let mut invalid = app();
        invalid["releases"][0]["manifestUrl"] = "http://example.com/mf.json".into();
        assert!(
            validate_catalog(&serde_json::json!({"schemaVersion":1,"apps":[invalid]}))
                .unwrap_err()
                .contains("HTTPS")
        );
        for local in [
            "http://localhost:4174/mf-manifest.json",
            "http://127.0.0.1/mf-manifest.json",
            "http://[::1]:4174/mf-manifest.json",
        ] {
            let mut local_app = app();
            local_app["releases"][0]["manifestUrl"] = local.into();
            assert!(validate_catalog(&serde_json::json!({"schemaVersion":1,"apps":[local_app]})).is_ok());
        }
        for unsafe_url in [
            "http://localhost.evil.test/mf.json",
            "http://localhost@evil.test/mf.json",
            "http://localhost:unsafe/mf.json",
        ] {
            let mut invalid = app();
            invalid["releases"][0]["manifestUrl"] = unsafe_url.into();
            assert!(validate_catalog(&serde_json::json!({"schemaVersion":1,"apps":[invalid]})).is_err());
        }
        let mut invalid = app();
        invalid["releases"][0]["remoteName"] = "".into();
        assert!(
            validate_catalog(&serde_json::json!({"schemaVersion":1,"apps":[invalid]}))
                .unwrap_err()
                .contains("remoteName")
        );
        let mut invalid = app();
        invalid["releases"][0]["exposedModule"] = "mount".into();
        assert!(
            validate_catalog(&serde_json::json!({"schemaVersion":1,"apps":[invalid]}))
                .unwrap_err()
                .contains("exposedModule")
        );
    }
}
