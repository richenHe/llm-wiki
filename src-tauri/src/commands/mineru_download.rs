use base64::Engine;
use futures::StreamExt;
use reqwest::Url;
use serde::Deserialize;
use std::collections::BTreeSet;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;

const MINERU_CDN_HOST: &str = "cdn-mineru.openxlab.org.cn";
const MAX_ZIP_BYTES: usize = 512 * 1024 * 1024;
const DOH_ENDPOINTS: [&str; 2] = ["https://dns.alidns.com/resolve", "https://doh.pub/resolve"];

#[derive(Debug, Deserialize)]
struct DohResponse {
    #[serde(default, rename = "Answer")]
    answers: Vec<DohAnswer>,
}

#[derive(Debug, Deserialize)]
struct DohAnswer {
    #[serde(rename = "type")]
    record_type: u16,
    data: String,
}

fn validate_mineru_zip_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|error| format!("invalid MinerU ZIP URL: {error}"))?;
    if url.scheme() != "https"
        || url.host_str() != Some(MINERU_CDN_HOST)
        || url.port().is_some_and(|port| port != 443)
        || !url.username().is_empty()
        || url.password().is_some()
        || !url.path().to_ascii_lowercase().ends_with(".zip")
    {
        return Err(format!(
            "direct download is restricted to HTTPS ZIP files on {MINERU_CDN_HOST}"
        ));
    }
    Ok(url)
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    !ip.is_private()
        && !ip.is_loopback()
        && !ip.is_link_local()
        && !ip.is_multicast()
        && !ip.is_unspecified()
        && ip != Ipv4Addr::BROADCAST
        && !(octets[0] == 100 && (64..=127).contains(&octets[1]))
        && !(octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        && !(octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
        && !(octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
        && !(octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
        && !(octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
        && octets[0] < 224
}

fn public_ipv4_answers(response: DohResponse) -> Vec<Ipv4Addr> {
    response
        .answers
        .into_iter()
        .filter(|answer| answer.record_type == 1)
        .filter_map(|answer| answer.data.parse::<Ipv4Addr>().ok())
        .filter(|ip| is_public_ipv4(*ip))
        .collect()
}

async fn resolve_mineru_public_addresses() -> Result<Vec<SocketAddr>, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("could not create DNS client: {error}"))?;
    let mut addresses = BTreeSet::new();
    let mut errors = Vec::new();

    for endpoint in DOH_ENDPOINTS {
        let response = client
            .get(endpoint)
            .query(&[("name", MINERU_CDN_HOST), ("type", "A")])
            .header("Accept", "application/dns-json")
            .send()
            .await;
        match response {
            Ok(response) if response.status().is_success() => {
                match response.json::<DohResponse>().await {
                    Ok(payload) => {
                        for ip in public_ipv4_answers(payload) {
                            addresses.insert(SocketAddr::new(IpAddr::V4(ip), 443));
                        }
                    }
                    Err(error) => errors.push(format!("{endpoint}: invalid DNS response: {error}")),
                }
            }
            Ok(response) => errors.push(format!("{endpoint}: HTTP {}", response.status())),
            Err(error) => errors.push(format!("{endpoint}: {error}")),
        }
    }

    if addresses.is_empty() {
        return Err(format!(
            "public DNS returned no safe MinerU CDN address{}",
            if errors.is_empty() {
                String::new()
            } else {
                format!(": {}", errors.join(" | "))
            }
        ));
    }
    Ok(addresses.into_iter().collect())
}

fn has_zip_signature(bytes: &[u8]) -> bool {
    matches!(
        bytes.get(..4),
        Some([b'P', b'K', 3, 4] | [b'P', b'K', 5, 6] | [b'P', b'K', 7, 8])
    )
}

#[tauri::command]
pub async fn download_mineru_zip_direct_cmd(url: String) -> Result<String, String> {
    let url = validate_mineru_zip_url(&url)?;
    let addresses = resolve_mineru_public_addresses().await?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .resolve_to_addrs(MINERU_CDN_HOST, &addresses)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| format!("could not create direct MinerU client: {error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("direct MinerU ZIP request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "direct MinerU ZIP request returned HTTP {}",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_ZIP_BYTES as u64)
    {
        return Err(format!(
            "MinerU ZIP exceeds the {} MB safety limit",
            MAX_ZIP_BYTES / 1024 / 1024
        ));
    }

    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("direct MinerU ZIP stream failed: {error}"))?;
        if bytes.len().saturating_add(chunk.len()) > MAX_ZIP_BYTES {
            return Err(format!(
                "MinerU ZIP exceeds the {} MB safety limit",
                MAX_ZIP_BYTES / 1024 / 1024
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    if !has_zip_signature(&bytes) {
        return Err("direct MinerU response is not a valid ZIP file".to_string());
    }

    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restricts_direct_download_to_the_official_mineru_zip_host() {
        assert!(validate_mineru_zip_url(
            "https://cdn-mineru.openxlab.org.cn/pdf/2026-08-04/result.zip"
        )
        .is_ok());
        assert!(validate_mineru_zip_url("http://cdn-mineru.openxlab.org.cn/result.zip").is_err());
        assert!(validate_mineru_zip_url("https://example.com/result.zip").is_err());
        assert!(validate_mineru_zip_url("https://cdn-mineru.openxlab.org.cn/result.pdf").is_err());
    }

    #[test]
    fn rejects_proxy_fake_ips_and_accepts_public_cdn_ips() {
        assert!(!is_public_ipv4(Ipv4Addr::new(198, 18, 0, 114)));
        assert!(!is_public_ipv4(Ipv4Addr::new(127, 0, 0, 1)));
        assert!(!is_public_ipv4(Ipv4Addr::new(192, 168, 1, 1)));
        assert!(is_public_ipv4(Ipv4Addr::new(183, 240, 235, 18)));
    }

    #[test]
    fn accepts_only_public_ipv4_dns_answers() {
        let addresses = public_ipv4_answers(DohResponse {
            answers: vec![
                DohAnswer {
                    record_type: 5,
                    data: "alias.example".into(),
                },
                DohAnswer {
                    record_type: 1,
                    data: "198.18.0.114".into(),
                },
                DohAnswer {
                    record_type: 1,
                    data: "120.233.206.21".into(),
                },
            ],
        });
        assert_eq!(addresses, vec![Ipv4Addr::new(120, 233, 206, 21)]);
    }

    #[test]
    fn checks_common_zip_signatures() {
        assert!(has_zip_signature(b"PK\x03\x04rest"));
        assert!(has_zip_signature(b"PK\x05\x06rest"));
        assert!(!has_zip_signature(b"<html>"));
    }

    #[tokio::test]
    #[ignore = "requires a live MinerU ZIP URL in MINERU_TEST_ZIP_URL"]
    async fn downloads_a_live_mineru_zip_while_the_system_proxy_remains_enabled() {
        let url = std::env::var("MINERU_TEST_ZIP_URL").expect("MINERU_TEST_ZIP_URL is required");
        let encoded = download_mineru_zip_direct_cmd(url)
            .await
            .expect("direct download failed");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("result was not base64");
        assert!(has_zip_signature(&bytes));
        assert!(bytes.len() > 1024);
    }
}
