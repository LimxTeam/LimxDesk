use serde::{Deserialize, Serialize};
use std::{
    fmt,
    net::{Ipv4Addr, SocketAddr, UdpSocket},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug)]
pub enum NetworkError {
    Io(std::io::Error),
    InvalidTarget(String),
    Clock(String),
}

impl fmt::Display for NetworkError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "{error}"),
            Self::InvalidTarget(message) | Self::Clock(message) => write!(formatter, "{message}"),
        }
    }
}

impl std::error::Error for NetworkError {}

impl From<std::io::Error> for NetworkError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

pub type NetworkResult<T> = Result<T, NetworkError>;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkOutputTarget {
    pub id: String,
    pub label: String,
    pub protocol: NetworkProtocol,
    #[serde(default = "default_output_mode")]
    pub mode: NetworkOutputMode,
    #[serde(default = "default_local_address")]
    pub local_address: String,
    pub destination: String,
    pub port: u16,
    #[serde(default = "default_local_universe")]
    pub local_universe: u16,
    #[serde(default = "default_amount")]
    pub amount: u16,
    #[serde(default)]
    pub artnet_net: u8,
    #[serde(default)]
    pub artnet_subnet: u8,
    #[serde(default)]
    pub artnet_universe: u8,
    #[serde(default = "default_sacn_universe")]
    pub sacn_universe: u16,
    #[serde(default = "default_priority")]
    pub priority: u8,
    #[serde(default = "default_ttl")]
    pub ttl: u8,
    #[serde(default)]
    pub delay_ms: f64,
    pub enabled: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NetworkProtocol {
    ArtNet,
    Sacn,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NetworkOutputMode {
    OutputBroadcast,
    OutputUnicast,
    OutputMulticast,
}

impl Default for NetworkOutputMode {
    fn default() -> Self {
        Self::OutputBroadcast
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterfaceInfo {
    pub id: String,
    pub name: String,
    pub address: String,
    pub netmask: String,
    pub broadcast: Option<String>,
    pub loopback: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkPacket {
    pub protocol: NetworkProtocol,
    pub local_address: String,
    pub destination: String,
    pub port: u16,
    pub ttl: Option<u8>,
    pub delay_ms: f64,
    pub payload: Vec<u8>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSendReport {
    pub packets: usize,
    pub bytes: usize,
    pub sent_at_ms: u64,
}

pub trait PacketTransport {
    fn send_packet(&self, packet: &NetworkPacket) -> NetworkResult<usize>;
}

#[derive(Clone, Debug, Default)]
pub struct UdpPacketTransport;

impl PacketTransport for UdpPacketTransport {
    fn send_packet(&self, packet: &NetworkPacket) -> NetworkResult<usize> {
        let destination: SocketAddr = format!("{}:{}", packet.destination, packet.port)
            .parse()
            .map_err(|_| NetworkError::InvalidTarget(packet.destination.clone()))?;
        let local_address = normalize_local_address(&packet.local_address);
        let socket = UdpSocket::bind(format!("{local_address}:0"))?;
        socket.set_broadcast(true)?;
        if let Some(ttl) = packet.ttl {
            socket.set_multicast_ttl_v4(u32::from(ttl.max(1)))?;
        }
        if packet.delay_ms.is_finite() && packet.delay_ms > 0.0 {
            thread::sleep(std::time::Duration::from_secs_f64(packet.delay_ms / 1000.0));
        }
        Ok(socket.send_to(&packet.payload, destination)?)
    }
}

pub fn send_packets(
    packets: &[NetworkPacket],
    transport: &impl PacketTransport,
) -> NetworkResult<NetworkSendReport> {
    let mut bytes = 0;
    let mut count = 0;
    for packet in packets {
        bytes += transport.send_packet(packet)?;
        count += 1;
    }

    Ok(NetworkSendReport {
        packets: count,
        bytes,
        sent_at_ms: current_timestamp_millis()?,
    })
}

fn current_timestamp_millis() -> NetworkResult<u64> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| NetworkError::Clock(error.to_string()))?;
    Ok(duration.as_millis().min(u128::from(u64::MAX)) as u64)
}

pub fn enumerate_network_interfaces() -> NetworkResult<Vec<NetworkInterfaceInfo>> {
    let mut interfaces = vec![NetworkInterfaceInfo {
        id: "any-ipv4".to_string(),
        name: "0.0.0.0 Broadcast".to_string(),
        address: "0.0.0.0".to_string(),
        netmask: "0.0.0.0".to_string(),
        broadcast: Some("255.255.255.255".to_string()),
        loopback: false,
    }];

    let system_interfaces = get_if_addrs::get_if_addrs()?;
    for (index, interface) in system_interfaces.into_iter().enumerate() {
        let get_if_addrs::IfAddr::V4(address) = interface.addr else {
            continue;
        };
        interfaces.push(NetworkInterfaceInfo {
            id: format!("{}-{}-{}", sanitize_id(&interface.name), address.ip, index),
            name: interface.name,
            address: address.ip.to_string(),
            netmask: address.netmask.to_string(),
            broadcast: address.broadcast.map(|value| value.to_string()),
            loopback: address.ip.is_loopback(),
        });
    }

    Ok(interfaces)
}

fn sanitize_id(value: &str) -> String {
    let mut id = String::new();
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            id.push(character.to_ascii_lowercase());
        } else if !id.ends_with('-') {
            id.push('-');
        }
    }
    id.trim_matches('-').to_string()
}

fn normalize_local_address(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "0.0.0.0" {
        return Ipv4Addr::UNSPECIFIED.to_string();
    }
    trimmed.to_string()
}

fn default_output_mode() -> NetworkOutputMode {
    NetworkOutputMode::OutputBroadcast
}

fn default_local_address() -> String {
    "0.0.0.0".to_string()
}

fn default_local_universe() -> u16 {
    1
}

fn default_amount() -> u16 {
    1
}

fn default_sacn_universe() -> u16 {
    1
}

fn default_priority() -> u8 {
    100
}

fn default_ttl() -> u8 {
    8
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryTransport {
        sent: Mutex<Vec<NetworkPacket>>,
    }

    impl PacketTransport for MemoryTransport {
        fn send_packet(&self, packet: &NetworkPacket) -> NetworkResult<usize> {
            self.sent.lock().unwrap().push(packet.clone());
            Ok(packet.payload.len())
        }
    }

    #[test]
    fn send_packets_reports_count_and_bytes() {
        let transport = MemoryTransport::default();
        let report = send_packets(
            &[NetworkPacket {
                protocol: NetworkProtocol::ArtNet,
                local_address: "0.0.0.0".to_string(),
                destination: "127.0.0.1".to_string(),
                port: 6454,
                ttl: None,
                delay_ms: 0.0,
                payload: vec![1, 2, 3],
            }],
            &transport,
        )
        .unwrap();

        assert_eq!(report.packets, 1);
        assert_eq!(report.bytes, 3);
        assert_eq!(transport.sent.lock().unwrap().len(), 1);
    }

    #[test]
    fn interface_enumeration_includes_any_broadcast_address() {
        let interfaces = enumerate_network_interfaces().unwrap();
        assert_eq!(interfaces[0].address, "0.0.0.0");
        assert_eq!(interfaces[0].broadcast.as_deref(), Some("255.255.255.255"));
    }
}
