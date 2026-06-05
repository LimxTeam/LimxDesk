use crate::{events, fixture_types, patch, programmer::ProgrammerState, show::ShowRuntimeState};
use limxdesk_artnet::{
    encode_artdmx, encode_sacn_dmp, DmxUniverseFrame as ProtocolUniverseFrame, ARTNET_PORT,
    SACN_PORT,
};
use limxdesk_dmx::{
    render_programmer_to_dmx, DmxAttributeProfile, DmxAttributeSlot, DmxFixturePatch,
    DmxFixtureTypeProfile, DmxModeProfile, DmxProgrammerValue, DmxRenderInput, DmxUniverseFrame,
};
use limxdesk_fixture_types::FixtureTypeEntry;
use limxdesk_network::{
    send_packets, NetworkOutputTarget, NetworkPacket, NetworkProtocol, UdpPacketTransport,
};
use limxdesk_patch::PatchDocument;
use limxdesk_programmer::{Programmer, ProgrammerMode};
use limxdesk_showfile::ShowRepository;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

const OUTPUT_SECTION_KEY: &str = "output.v1";
const OUTPUT_SECTION_VERSION: u16 = 1;

#[derive(Debug)]
pub struct OutputState {
    targets: Mutex<Vec<NetworkOutputTarget>>,
    sequence: Mutex<u8>,
    cache: Mutex<Option<OutputRuntimeCache>>,
    worker: Mutex<OutputWorkerState>,
}

impl Default for OutputState {
    fn default() -> Self {
        Self {
            targets: Mutex::new(default_targets()),
            sequence: Mutex::new(1),
            cache: Mutex::new(None),
            worker: Mutex::new(OutputWorkerState::default()),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputSendReport {
    pub frames: usize,
    pub packets: usize,
    pub bytes: usize,
    pub sent_at_ms: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputDocument {
    targets: Vec<NetworkOutputTarget>,
}

#[derive(Clone, Debug)]
struct OutputRuntimeCache {
    show_path: String,
    show_modified_at_ms: u64,
    fixtures: Vec<DmxFixturePatch>,
    fixture_types: Vec<DmxFixtureTypeProfile>,
    targets: Vec<NetworkOutputTarget>,
}

#[derive(Clone, Debug, Default)]
struct OutputWorkerState {
    running: bool,
    dirty: bool,
}

#[tauri::command]
pub fn output_get_targets(
    show_state: State<'_, ShowRuntimeState>,
    state: State<'_, OutputState>,
) -> Result<Vec<NetworkOutputTarget>, String> {
    let targets = load_targets_from_show(&show_state)?.unwrap_or_else(default_targets);
    set_runtime_targets(&state, targets.clone())?;
    Ok(targets)
}

#[tauri::command]
pub fn output_set_targets(
    targets: Vec<NetworkOutputTarget>,
    show_state: State<'_, ShowRuntimeState>,
    state: State<'_, OutputState>,
    app: AppHandle,
) -> Result<Vec<NetworkOutputTarget>, String> {
    let targets = normalize_targets(targets);
    let Some(show) = show_state.current()? else {
        return Err(
            "No show file loaded. Create or load a show before saving output settings.".to_string(),
        );
    };
    let loaded = ShowRepository::default_for_current_os()
        .write_section(
            &show.path,
            OUTPUT_SECTION_KEY,
            OUTPUT_SECTION_VERSION,
            &OutputDocument {
                targets: targets.clone(),
            },
        )
        .map_err(|error| error.to_string())?;
    show_state.set_current(loaded)?;
    let changed_show = show_state.current()?;
    set_runtime_targets(&state, targets.clone())?;
    events::emit_output_changed(&app, changed_show.as_ref());
    Ok(targets)
}

#[tauri::command]
pub fn output_render_dmx(
    show_state: State<'_, ShowRuntimeState>,
    programmer_state: State<'_, ProgrammerState>,
    output_state: State<'_, OutputState>,
) -> Result<Vec<DmxUniverseFrame>, String> {
    render_current_dmx(&show_state, &programmer_state, &output_state)
}

#[tauri::command]
pub fn output_send_current(
    show_state: State<'_, ShowRuntimeState>,
    programmer_state: State<'_, ProgrammerState>,
    output_state: State<'_, OutputState>,
    app: AppHandle,
) -> Result<OutputSendReport, String> {
    let report = send_current_output(&show_state, &programmer_state, &output_state)?;
    events::emit_output_sent(&app, &report);
    Ok(report)
}

pub(crate) fn send_current_output(
    show_state: &State<'_, ShowRuntimeState>,
    programmer_state: &State<'_, ProgrammerState>,
    output_state: &State<'_, OutputState>,
) -> Result<OutputSendReport, String> {
    let frames = render_current_dmx(show_state, programmer_state, output_state)?;
    let sequence = next_sequence(output_state)?;
    let targets = runtime_targets(show_state, output_state)?;
    let packets = build_network_packets(&frames, &targets, sequence)?;
    let report = send_packets(&packets, &UdpPacketTransport).map_err(|error| error.to_string())?;
    Ok(OutputSendReport {
        frames: frames.len(),
        packets: report.packets,
        bytes: report.bytes,
        sent_at_ms: report.sent_at_ms,
    })
}

pub(crate) fn request_output_send(app: &AppHandle) -> Result<(), String> {
    let output_state = app.state::<OutputState>();
    {
        let mut worker = output_state
            .worker
            .lock()
            .map_err(|_| "output worker state lock poisoned".to_string())?;
        worker.dirty = true;
        if worker.running {
            return Ok(());
        }
        worker.running = true;
    }

    let app = app.clone();
    std::thread::spawn(move || loop {
        {
            let output_state = app.state::<OutputState>();
            let mut worker = match output_state.worker.lock() {
                Ok(worker) => worker,
                Err(_) => {
                    tracing::warn!("output worker state lock poisoned");
                    return;
                }
            };
            worker.dirty = false;
        }

        let show_state = app.state::<ShowRuntimeState>();
        let programmer_state = app.state::<ProgrammerState>();
        let output_state = app.state::<OutputState>();
        match send_current_output(&show_state, &programmer_state, &output_state) {
            Ok(report) => events::emit_output_sent(&app, &report),
            Err(error) => tracing::warn!("failed to send programmer output: {error}"),
        }

        let output_state = app.state::<OutputState>();
        let mut worker = match output_state.worker.lock() {
            Ok(worker) => worker,
            Err(_) => {
                tracing::warn!("output worker state lock poisoned");
                return;
            }
        };
        if worker.dirty {
            continue;
        }
        worker.running = false;
        return;
    });

    Ok(())
}

fn render_current_dmx(
    show_state: &State<'_, ShowRuntimeState>,
    programmer_state: &State<'_, ProgrammerState>,
    output_state: &State<'_, OutputState>,
) -> Result<Vec<DmxUniverseFrame>, String> {
    let Some(cache) = runtime_cache(show_state, output_state)? else {
        return Ok(Vec::new());
    };
    let programmer = programmer_state.current()?;
    let input = render_input_from_cache(&cache, &programmer);
    render_programmer_to_dmx(&input).map_err(|error| error.to_string())
}

fn render_input_from_cache(cache: &OutputRuntimeCache, programmer: &Programmer) -> DmxRenderInput {
    DmxRenderInput {
        fixtures: cache.fixtures.clone(),
        fixture_types: cache.fixture_types.clone(),
        programmer_values: active_programmer_values(programmer),
    }
}

fn active_programmer_values(programmer: &Programmer) -> Vec<DmxProgrammerValue> {
    let buffer = match programmer.mode {
        ProgrammerMode::Live => &programmer.live,
        ProgrammerMode::Preview => &programmer.preview,
    };
    buffer
        .parts
        .iter()
        .flat_map(|part| part.values.iter())
        .map(|value| DmxProgrammerValue {
            fixture_id: value.fixture_id.clone(),
            attribute: value.attribute.clone(),
            numeric: value.value.numeric,
            active: value.active,
        })
        .collect()
}

fn build_network_packets(
    frames: &[DmxUniverseFrame],
    targets: &[NetworkOutputTarget],
    sequence: u8,
) -> Result<Vec<NetworkPacket>, String> {
    let mut packets = Vec::new();
    for target in targets.iter().filter(|target| target.enabled) {
        for frame in frames {
            let protocol_frame = ProtocolUniverseFrame {
                universe: frame.universe,
                data: frame.data.clone(),
            };
            let (payload, destination, port) = match target.protocol {
                NetworkProtocol::ArtNet => (
                    encode_artdmx(&protocol_frame, sequence).map_err(|error| error.to_string())?,
                    target.destination.clone(),
                    if target.port == 0 {
                        ARTNET_PORT
                    } else {
                        target.port
                    },
                ),
                NetworkProtocol::Sacn => (
                    encode_sacn_dmp(&protocol_frame, sequence, "LimxDesk")
                        .map_err(|error| error.to_string())?,
                    resolve_sacn_destination(target, frame.universe),
                    if target.port == 0 {
                        SACN_PORT
                    } else {
                        target.port
                    },
                ),
            };
            packets.push(NetworkPacket {
                protocol: target.protocol,
                destination,
                port,
                payload,
            });
        }
    }
    Ok(packets)
}

fn resolve_sacn_destination(target: &NetworkOutputTarget, universe: u16) -> String {
    if !target.destination.eq_ignore_ascii_case("multicast") {
        return target.destination.clone();
    }
    format!("239.255.{}.{}", universe / 256, universe % 256)
}

fn next_sequence(state: &State<'_, OutputState>) -> Result<u8, String> {
    let mut sequence = state
        .sequence
        .lock()
        .map_err(|_| "output sequence state lock poisoned".to_string())?;
    let current = *sequence;
    *sequence = sequence.wrapping_add(1).max(1);
    Ok(current)
}

fn default_targets() -> Vec<NetworkOutputTarget> {
    vec![
        NetworkOutputTarget {
            id: "artnet-broadcast".to_string(),
            label: "Art-Net Broadcast".to_string(),
            protocol: NetworkProtocol::ArtNet,
            destination: "255.255.255.255".to_string(),
            port: ARTNET_PORT,
            enabled: true,
        },
        NetworkOutputTarget {
            id: "sacn-multicast".to_string(),
            label: "sACN Multicast".to_string(),
            protocol: NetworkProtocol::Sacn,
            destination: "multicast".to_string(),
            port: SACN_PORT,
            enabled: true,
        },
    ]
}

fn runtime_targets(
    show_state: &State<'_, ShowRuntimeState>,
    output_state: &State<'_, OutputState>,
) -> Result<Vec<NetworkOutputTarget>, String> {
    if let Some(cache) = runtime_cache(show_state, output_state)? {
        return Ok(cache.targets);
    }

    Ok(output_state
        .targets
        .lock()
        .map(|targets| targets.clone())
        .unwrap_or_else(|_| default_targets()))
}

fn runtime_cache(
    show_state: &State<'_, ShowRuntimeState>,
    output_state: &State<'_, OutputState>,
) -> Result<Option<OutputRuntimeCache>, String> {
    let Some(show) = show_state.current()? else {
        clear_runtime_cache(output_state)?;
        return Ok(None);
    };

    if let Some(cache) = output_state
        .cache
        .lock()
        .map_err(|_| "output runtime cache lock poisoned".to_string())?
        .clone()
    {
        if cache.show_path == show.path && cache.show_modified_at_ms == show.manifest.modified_at_ms
        {
            return Ok(Some(cache));
        }
    }

    let document = patch::patch_load_current_show(show_state.clone())?.unwrap_or_default();
    let fixture_types = fixture_types::fixture_type_scan_current_show(show_state.clone())?;
    let targets = load_targets_from_show(show_state)?.unwrap_or_else(default_targets);
    let cache = OutputRuntimeCache {
        show_path: show.path,
        show_modified_at_ms: show.manifest.modified_at_ms,
        fixtures: dmx_fixtures_from_patch(&document),
        fixture_types: dmx_profiles_from_fixture_types(&fixture_types),
        targets: targets.clone(),
    };
    set_runtime_targets(output_state, targets)?;

    let mut current = output_state
        .cache
        .lock()
        .map_err(|_| "output runtime cache lock poisoned".to_string())?;
    *current = Some(cache.clone());
    Ok(Some(cache))
}

fn clear_runtime_cache(output_state: &State<'_, OutputState>) -> Result<(), String> {
    let mut current = output_state
        .cache
        .lock()
        .map_err(|_| "output runtime cache lock poisoned".to_string())?;
    *current = None;
    Ok(())
}

fn dmx_fixtures_from_patch(document: &PatchDocument) -> Vec<DmxFixturePatch> {
    document
        .fixtures
        .iter()
        .map(|fixture| DmxFixturePatch {
            id: fixture.id.clone(),
            fixture_type_id: fixture.fixture_type_id.clone(),
            fixture_type_path: fixture.fixture_type_path.clone(),
            mode_id: fixture.mode_id.clone(),
            mode_name: fixture.mode_name.clone(),
            universe: fixture.universe,
            address: fixture.address,
        })
        .collect()
}

fn dmx_profiles_from_fixture_types(
    fixture_types: &[FixtureTypeEntry],
) -> Vec<DmxFixtureTypeProfile> {
    fixture_types
        .iter()
        .map(|fixture_type| DmxFixtureTypeProfile {
            id: fixture_type.id.clone(),
            path: fixture_type.path.clone(),
            modes: fixture_type
                .modes
                .iter()
                .map(|mode| DmxModeProfile {
                    id: mode.id.clone(),
                    name: mode.name.clone(),
                    channels: mode.channels,
                    attributes: mode
                        .attribute_details
                        .iter()
                        .map(|attribute| DmxAttributeProfile {
                            name: attribute.name.clone(),
                            feature_group: attribute.feature_group.clone(),
                            value_kind: attribute.value_kind.clone(),
                            min_value: attribute.min_value,
                            max_value: attribute.max_value,
                            dmx_slots: attribute
                                .dmx_slots
                                .iter()
                                .map(|slot| DmxAttributeSlot {
                                    module_id: slot.module_id.clone(),
                                    offsets: slot.offsets.clone(),
                                    physical_from: slot.physical_from,
                                    physical_to: slot.physical_to,
                                })
                                .collect(),
                        })
                        .collect(),
                })
                .collect(),
        })
        .collect()
}

fn load_targets_from_show(
    show_state: &State<'_, ShowRuntimeState>,
) -> Result<Option<Vec<NetworkOutputTarget>>, String> {
    let Some(show) = show_state.current()? else {
        return Ok(None);
    };
    let document = ShowRepository::default_for_current_os()
        .read_section::<OutputDocument>(&show.path, OUTPUT_SECTION_KEY)
        .map_err(|error| error.to_string())?;
    Ok(document.map(|document| normalize_targets(document.targets)))
}

fn set_runtime_targets(
    state: &State<'_, OutputState>,
    targets: Vec<NetworkOutputTarget>,
) -> Result<(), String> {
    let mut current = state
        .targets
        .lock()
        .map_err(|_| "output target state lock poisoned".to_string())?;
    *current = targets;
    Ok(())
}

fn normalize_targets(targets: Vec<NetworkOutputTarget>) -> Vec<NetworkOutputTarget> {
    if targets.is_empty() {
        return default_targets();
    }

    targets
        .into_iter()
        .map(|mut target| {
            if target.id.trim().is_empty() {
                target.id = format!("{:?}-{}", target.protocol, target.destination);
            }
            if target.label.trim().is_empty() {
                target.label = target.id.clone();
            }
            if target.port == 0 {
                target.port = match target.protocol {
                    NetworkProtocol::ArtNet => ARTNET_PORT,
                    NetworkProtocol::Sacn => SACN_PORT,
                };
            }
            target
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use limxdesk_network::NetworkProtocol;

    #[test]
    fn resolves_sacn_multicast_per_universe() {
        let target = NetworkOutputTarget {
            id: "sacn".to_string(),
            label: "sACN".to_string(),
            protocol: NetworkProtocol::Sacn,
            destination: "multicast".to_string(),
            port: 0,
            enabled: true,
        };

        assert_eq!(resolve_sacn_destination(&target, 1), "239.255.0.1");
        assert_eq!(resolve_sacn_destination(&target, 257), "239.255.1.1");
    }

    #[test]
    fn network_packets_keep_zero_tail_channels() {
        let target = NetworkOutputTarget {
            id: "artnet".to_string(),
            label: "Art-Net".to_string(),
            protocol: NetworkProtocol::ArtNet,
            destination: "127.0.0.1".to_string(),
            port: 0,
            enabled: true,
        };
        let mut data = vec![0_u8; 512];
        data[25] = 3;

        let packets =
            build_network_packets(&[DmxUniverseFrame { universe: 1, data }], &[target], 1).unwrap();

        assert_eq!(packets.len(), 1);
        assert_eq!(&packets[0].payload[16..18], &512_u16.to_be_bytes());
        assert_eq!(packets[0].payload.len(), 18 + 512);
        assert_eq!(packets[0].payload[18 + 25], 3);
        assert_eq!(packets[0].payload[18 + 26], 0);
        assert_eq!(packets[0].payload[18 + 27], 0);
    }
}
