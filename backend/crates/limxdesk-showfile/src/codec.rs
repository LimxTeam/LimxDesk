use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};

use crate::repository::{ShowContainer, ShowFileError, ShowFileResult};

const MAGIC: &[u8] = b"LIMXDESK_SHOW_1";
const CODEC_VERSION: u16 = 1;
const NONCE_LEN: usize = 12;
const LENGTH_LEN: usize = 8;

pub fn encode_container(container: &ShowContainer) -> ShowFileResult<Vec<u8>> {
    let plain = serde_json::to_vec(container)?;
    let cipher = cipher();

    let mut nonce = [0_u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);

    let encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce), plain.as_ref())
        .map_err(|_| ShowFileError::Crypto("failed to encrypt show payload".to_string()))?;

    let mut bytes = Vec::with_capacity(MAGIC.len() + 2 + NONCE_LEN + LENGTH_LEN + encrypted.len());
    bytes.extend_from_slice(MAGIC);
    bytes.extend_from_slice(&CODEC_VERSION.to_le_bytes());
    bytes.extend_from_slice(&nonce);
    bytes.extend_from_slice(&(encrypted.len() as u64).to_le_bytes());
    bytes.extend_from_slice(&encrypted);
    Ok(bytes)
}

pub fn decode_container(bytes: &[u8]) -> ShowFileResult<ShowContainer> {
    let header_len = MAGIC.len() + 2 + NONCE_LEN + LENGTH_LEN;
    if bytes.len() < header_len {
        return Err(ShowFileError::InvalidFormat(
            "show file is too small".to_string(),
        ));
    }

    if &bytes[..MAGIC.len()] != MAGIC {
        return Err(ShowFileError::InvalidFormat(
            "show file signature mismatch".to_string(),
        ));
    }

    let version_offset = MAGIC.len();
    let version = u16::from_le_bytes([bytes[version_offset], bytes[version_offset + 1]]);
    if version != CODEC_VERSION {
        return Err(ShowFileError::InvalidFormat(format!(
            "unsupported show codec version {version}"
        )));
    }

    let nonce_offset = version_offset + 2;
    let length_offset = nonce_offset + NONCE_LEN;
    let payload_offset = length_offset + LENGTH_LEN;

    let mut payload_length_bytes = [0_u8; LENGTH_LEN];
    payload_length_bytes.copy_from_slice(&bytes[length_offset..payload_offset]);
    let payload_length = u64::from_le_bytes(payload_length_bytes) as usize;

    if bytes.len() != payload_offset + payload_length {
        return Err(ShowFileError::InvalidFormat(
            "show file payload length mismatch".to_string(),
        ));
    }

    let plain = cipher()
        .decrypt(
            Nonce::from_slice(&bytes[nonce_offset..length_offset]),
            &bytes[payload_offset..],
        )
        .map_err(|_| ShowFileError::Crypto("failed to decrypt show payload".to_string()))?;

    Ok(serde_json::from_slice(&plain)?)
}

fn cipher() -> Aes256Gcm {
    let key = Sha256::digest(b"LimxDesk show container encryption key v1");
    Aes256Gcm::new_from_slice(&key).expect("AES-256 key length is fixed")
}
