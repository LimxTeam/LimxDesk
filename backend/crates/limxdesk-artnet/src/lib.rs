use serde::{Deserialize, Serialize};
use std::fmt;

pub const ARTNET_PORT: u16 = 6454;
pub const SACN_PORT: u16 = 5568;
const ARTNET_ID: &[u8; 8] = b"Art-Net\0";
const SACN_CID: [u8; 16] = *b"LimxDeskNode2026";

#[derive(Debug)]
pub enum ProtocolError {
    InvalidUniverse(u16),
    InvalidDataLength(usize),
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidUniverse(universe) => write!(formatter, "invalid universe: {universe}"),
            Self::InvalidDataLength(length) => {
                write!(formatter, "invalid DMX data length: {length}")
            }
        }
    }
}

impl std::error::Error for ProtocolError {}

pub type ProtocolResult<T> = Result<T, ProtocolError>;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DmxUniverseFrame {
    pub universe: u16,
    pub data: Vec<u8>,
}

pub fn encode_artdmx(frame: &DmxUniverseFrame, sequence: u8) -> ProtocolResult<Vec<u8>> {
    validate_frame(frame)?;
    let artnet_universe = frame.universe.saturating_sub(1);
    let length = frame.data.len() as u16;
    let mut packet = Vec::with_capacity(18 + frame.data.len());
    packet.extend_from_slice(ARTNET_ID);
    packet.extend_from_slice(&0x5000_u16.to_le_bytes());
    packet.extend_from_slice(&14_u16.to_be_bytes());
    packet.push(sequence);
    packet.push(0);
    packet.extend_from_slice(&artnet_universe.to_le_bytes());
    packet.extend_from_slice(&length.to_be_bytes());
    packet.extend_from_slice(&frame.data);
    Ok(packet)
}

pub fn encode_sacn_dmp(
    frame: &DmxUniverseFrame,
    sequence: u8,
    source_name: &str,
) -> ProtocolResult<Vec<u8>> {
    validate_frame(frame)?;
    let property_count = (frame.data.len() + 1) as u16;
    let root_pdu_length = 38 + 77 + 11 + usize::from(property_count);
    let framing_pdu_length = 77 + 11 + usize::from(property_count);
    let dmp_pdu_length = 11 + usize::from(property_count);
    let mut packet = Vec::with_capacity(126 + frame.data.len());

    packet.extend_from_slice(&0x0010_u16.to_be_bytes());
    packet.extend_from_slice(&0x0000_u16.to_be_bytes());
    packet.extend_from_slice(b"ASC-E1.17\0\0\0");
    write_flags_length(&mut packet, root_pdu_length);
    packet.extend_from_slice(&0x0000_0004_u32.to_be_bytes());
    packet.extend_from_slice(&SACN_CID);

    write_flags_length(&mut packet, framing_pdu_length);
    packet.extend_from_slice(&0x0000_0002_u32.to_be_bytes());
    let mut source = [0_u8; 64];
    let bytes = source_name.as_bytes();
    let len = bytes.len().min(source.len());
    source[..len].copy_from_slice(&bytes[..len]);
    packet.extend_from_slice(&source);
    packet.push(100);
    packet.extend_from_slice(&0x0000_u16.to_be_bytes());
    packet.push(sequence);
    packet.push(0);
    packet.extend_from_slice(&frame.universe.to_be_bytes());

    write_flags_length(&mut packet, dmp_pdu_length);
    packet.push(0x02);
    packet.push(0xA1);
    packet.extend_from_slice(&0x0000_u16.to_be_bytes());
    packet.extend_from_slice(&0x0001_u16.to_be_bytes());
    packet.extend_from_slice(&property_count.to_be_bytes());
    packet.push(0);
    packet.extend_from_slice(&frame.data);
    Ok(packet)
}

fn validate_frame(frame: &DmxUniverseFrame) -> ProtocolResult<()> {
    if frame.universe == 0 || frame.universe > 63_999 {
        return Err(ProtocolError::InvalidUniverse(frame.universe));
    }
    if frame.data.is_empty() || frame.data.len() > 512 {
        return Err(ProtocolError::InvalidDataLength(frame.data.len()));
    }
    Ok(())
}

fn write_flags_length(packet: &mut Vec<u8>, length: usize) {
    let value = 0x7000_u16 | (length as u16 & 0x0fff);
    packet.extend_from_slice(&value.to_be_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_artdmx_packet() {
        let packet = encode_artdmx(
            &DmxUniverseFrame {
                universe: 1,
                data: vec![255, 0, 127],
            },
            9,
        )
        .unwrap();

        assert_eq!(&packet[0..8], ARTNET_ID);
        assert_eq!(&packet[8..10], &0x5000_u16.to_le_bytes());
        assert_eq!(packet[12], 9);
        assert_eq!(&packet[16..18], &3_u16.to_be_bytes());
        assert_eq!(&packet[18..], &[255, 0, 127]);
    }

    #[test]
    fn encodes_sacn_packet_with_start_code() {
        let packet = encode_sacn_dmp(
            &DmxUniverseFrame {
                universe: 1,
                data: vec![1, 2, 3],
            },
            4,
            "LimxDesk",
        )
        .unwrap();

        assert_eq!(&packet[4..16], b"ASC-E1.17\0\0\0");
        assert_eq!(packet[111], 4);
        assert_eq!(packet[125], 0);
        assert_eq!(&packet[126..], &[1, 2, 3]);
    }
}
