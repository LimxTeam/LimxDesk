use serde::{Deserialize, Serialize};
use std::{
    fmt,
    net::{SocketAddr, UdpSocket},
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

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkOutputTarget {
    pub id: String,
    pub label: String,
    pub protocol: NetworkProtocol,
    pub destination: String,
    pub port: u16,
    pub enabled: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NetworkProtocol {
    ArtNet,
    Sacn,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkPacket {
    pub protocol: NetworkProtocol,
    pub destination: String,
    pub port: u16,
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
        let socket = UdpSocket::bind("0.0.0.0:0")?;
        socket.set_broadcast(true)?;
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
                destination: "127.0.0.1".to_string(),
                port: 6454,
                payload: vec![1, 2, 3],
            }],
            &transport,
        )
        .unwrap();

        assert_eq!(report.packets, 1);
        assert_eq!(report.bytes, 3);
        assert_eq!(transport.sent.lock().unwrap().len(), 1);
    }
}
