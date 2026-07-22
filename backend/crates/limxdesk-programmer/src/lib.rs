use limxdesk_effect::{normalize_effects, AppliedEffect};
use limxdesk_fixture_selection::FixtureSelection;
use serde::{Deserialize, Serialize};
use std::fmt;

pub const MAX_PROGRAMMER_PARTS: u16 = 240;

#[derive(Debug)]
pub enum ProgrammerError {
    EmptySelection,
    InvalidPart(u16),
    InvalidAttribute(String),
}

impl fmt::Display for ProgrammerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptySelection => write!(formatter, "no fixtures selected"),
            Self::InvalidPart(part) => write!(formatter, "invalid programmer part: {part}"),
            Self::InvalidAttribute(attribute) => {
                write!(formatter, "invalid programmer attribute: {attribute}")
            }
        }
    }
}

impl std::error::Error for ProgrammerError {}

pub type ProgrammerResult<T> = Result<T, ProgrammerError>;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Programmer {
    pub live: ProgrammerBuffer,
    pub preview: ProgrammerBuffer,
    pub mode: ProgrammerMode,
    pub blind: bool,
    pub selection: ProgrammerSelectionContext,
    pub version: u64,
}

impl Default for Programmer {
    fn default() -> Self {
        Self {
            live: ProgrammerBuffer::default(),
            preview: ProgrammerBuffer::default(),
            mode: ProgrammerMode::Live,
            blind: false,
            selection: ProgrammerSelectionContext::default(),
            version: 0,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProgrammerBuffer {
    pub selected_part_id: u16,
    pub parts: Vec<ProgrammerPart>,
    /// 效果层。
    ///
    /// 效果与属性值平级地待在 programmer 里 —— 选灯之后加一个效果，和给
    /// 同一批灯设一个 Dimmer 值属于同一类操作。Store 时它随 parts 一起走，
    /// Clear 也一并清掉。
    #[serde(default)]
    pub effects: Vec<AppliedEffect>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProgrammerPart {
    pub id: u16,
    pub label: Option<String>,
    pub values: Vec<ProgrammerValue>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProgrammerValue {
    pub fixture_id: String,
    pub attribute: String,
    pub feature_group: String,
    pub layer: ProgrammerLayer,
    pub value: ProgrammerScalar,
    pub active: bool,
    pub source: ProgrammerValueSource,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProgrammerScalar {
    pub numeric: Option<f64>,
    pub text: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProgrammerSelectionContext {
    pub order: Vec<SelectionItem>,
    pub primary_fixture_id: Option<String>,
    pub cursor: usize,
    pub grid: SelectionGridState,
    pub matricks: SelectionMatricks,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SelectionItem {
    pub fixture_id: String,
    pub order_index: usize,
    pub grid: GridPosition,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GridPosition {
    pub x: i32,
    pub y: i32,
    pub z: i32,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SelectionGridState {
    pub setup_mode: bool,
    pub cursor: GridPosition,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SelectionMatricks {
    pub active: bool,
    pub x: MatricksAxis,
    pub y: MatricksAxis,
    pub z: MatricksAxis,
    pub shuffle_seed: Option<u64>,
}

impl Default for SelectionMatricks {
    fn default() -> Self {
        Self {
            active: false,
            x: MatricksAxis::default(),
            y: MatricksAxis::default(),
            z: MatricksAxis::default(),
            shuffle_seed: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MatricksAxis {
    pub index: i32,
    pub blocks: u16,
    pub groups: u16,
    pub wings: u16,
    pub width: u16,
    pub shift: i32,
    pub invert: bool,
    pub align_range: bool,
}

impl Default for MatricksAxis {
    fn default() -> Self {
        Self {
            index: 0,
            blocks: 1,
            groups: 1,
            wings: 1,
            width: 0,
            shift: 0,
            invert: false,
            align_range: false,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum SelectionTool {
    Previous,
    Next,
    Set,
    ResetMatricks,
    LinearizeNumerical,
    LinearizeGridLeftToRight,
    TransposeGrid,
    MirrorX,
    MirrorY,
    MirrorZ,
    Shuffle { seed: u64 },
    ToggleGridSetup,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProgrammerMode {
    Live,
    Preview,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProgrammerLayer {
    Absolute,
    Relative,
    Fade,
    Delay,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProgrammerValueSource {
    Manual,
    Preset,
    Output,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProgrammerClearTarget {
    Contextual,
    Selection,
    Active,
    All,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StoreUseSelection {
    Active,
    ActiveForSelected,
    All,
    AllForSelected,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgrammerSetAttributeRequest {
    pub attribute: String,
    pub feature_group: String,
    pub layer: ProgrammerLayer,
    pub value: ProgrammerScalar,
    pub source: ProgrammerValueSource,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgrammerAdjustAttributeRequest {
    pub attribute: String,
    pub feature_group: String,
    pub layer: ProgrammerLayer,
    pub delta: f64,
    pub value_kind: String,
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
    pub default_value: Option<f64>,
    pub source: ProgrammerValueSource,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgrammerClearResult {
    pub programmer: Programmer,
    pub clear_selection: bool,
    pub cleared_level: ProgrammerClearedLevel,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProgrammerClearedLevel {
    Selection,
    Active,
    All,
    None,
}

impl Programmer {
    pub fn sync_selection(mut self, selection: &FixtureSelection) -> Self {
        self.selection = self.selection.with_fixture_selection(selection);
        self.bump_version();
        self
    }

    pub fn apply_selection_tool(mut self, tool: SelectionTool) -> Self {
        self.selection = self.selection.apply_tool(tool);
        self.bump_version();
        self
    }

    pub fn effective_fixture_selection(&self) -> FixtureSelection {
        let fixture_ids = self.selection.effective_fixture_ids();
        FixtureSelection {
            primary_fixture_id: fixture_ids.first().cloned(),
            fixture_ids,
            version: self.version,
        }
    }

    pub fn set_attribute_for_selection(
        mut self,
        selection: &FixtureSelection,
        request: ProgrammerSetAttributeRequest,
    ) -> ProgrammerResult<Self> {
        self = self.set_attributes_for_selection(selection, vec![request])?;
        Ok(self)
    }

    pub fn set_attributes_for_selection(
        mut self,
        selection: &FixtureSelection,
        requests: Vec<ProgrammerSetAttributeRequest>,
    ) -> ProgrammerResult<Self> {
        self = self.sync_selection(selection);
        let effective_selection = self.effective_fixture_selection();
        if effective_selection.fixture_ids.is_empty() {
            return Err(ProgrammerError::EmptySelection);
        }
        if requests.is_empty() {
            return Ok(self);
        }

        let buffer = self.active_buffer_mut();
        let selected_part_id = buffer.selected_part_id;
        let part = buffer.ensure_part(selected_part_id)?;
        for request in requests {
            validate_attribute(&request.attribute)?;
            for fixture_id in &effective_selection.fixture_ids {
                part.upsert_value(ProgrammerValue {
                    fixture_id: fixture_id.clone(),
                    attribute: request.attribute.clone(),
                    feature_group: default_if_empty(&request.feature_group, "Control").to_string(),
                    layer: request.layer,
                    value: request.value.clone(),
                    active: true,
                    source: request.source,
                });
            }
        }

        self.bump_version();
        Ok(self)
    }

    pub fn adjust_attribute_for_selection(
        mut self,
        selection: &FixtureSelection,
        request: ProgrammerAdjustAttributeRequest,
    ) -> ProgrammerResult<Self> {
        self = self.sync_selection(selection);
        let effective_selection = self.effective_fixture_selection();
        if effective_selection.fixture_ids.is_empty() {
            return Err(ProgrammerError::EmptySelection);
        }
        validate_attribute(&request.attribute)?;

        let buffer = self.active_buffer_mut();
        let selected_part_id = buffer.selected_part_id;
        let part = buffer.ensure_part(selected_part_id)?;
        for fixture_id in &effective_selection.fixture_ids {
            let current = part
                .values
                .iter()
                .find(|value| {
                    value.fixture_id == *fixture_id
                        && value.attribute == request.attribute
                        && value.layer == request.layer
                        && value.active
                })
                .and_then(|value| value.value.numeric)
                .unwrap_or_else(|| request.default_numeric());
            let value = request.adjusted_value(current);
            part.upsert_value(ProgrammerValue {
                fixture_id: fixture_id.clone(),
                attribute: request.attribute.clone(),
                feature_group: default_if_empty(&request.feature_group, "Control").to_string(),
                layer: request.layer,
                value,
                active: true,
                source: request.source,
            });
        }

        self.bump_version();
        Ok(self)
    }

    /// 给当前选择加一个效果实例。
    ///
    /// 同一个模板重复应用到同一批灯时替换而不是叠加 —— 再点一次效果池
    /// 应当是"重新应用"，不是把两份一样的东西摞起来。
    pub fn apply_effect(mut self, applied: AppliedEffect) -> Self {
        if applied.fixture_ids.is_empty() {
            return self;
        }
        let buffer = self.active_buffer_mut();
        match buffer.effects.iter_mut().find(|existing| {
            existing.effect_id == applied.effect_id && existing.fixture_ids == applied.fixture_ids
        }) {
            Some(existing) => *existing = applied,
            None => buffer.effects.push(applied),
        }
        self.bump_version();
        self
    }

    pub fn remove_effect(mut self, applied_id: &str) -> Self {
        self.active_buffer_mut()
            .effects
            .retain(|effect| effect.id != applied_id);
        self.bump_version();
        self
    }

    /// 改一个效果实例的参数覆盖。
    pub fn update_effect(mut self, applied: AppliedEffect) -> Self {
        if let Some(existing) = self
            .active_buffer_mut()
            .effects
            .iter_mut()
            .find(|existing| existing.id == applied.id)
        {
            *existing = applied;
        }
        self.bump_version();
        self
    }

    pub fn effects(&self) -> &[AppliedEffect] {
        &self.active_buffer().effects
    }

    /// 收集要存进 cue 的效果实例。
    ///
    /// 与 store_values 同一套取舍：按选择过滤时，实例上不属于选择的灯
    /// 要摘掉，摘空了就整条不存 —— 存一个作用于零盏灯的效果没有意义。
    pub fn store_effects(
        &self,
        use_selection: StoreUseSelection,
        selection: &FixtureSelection,
    ) -> Vec<AppliedEffect> {
        let effects = self
            .active_buffer()
            .effects
            .iter()
            .filter(|effect| effect.has_output())
            .cloned();

        match use_selection {
            StoreUseSelection::Active | StoreUseSelection::All => normalize_effects(effects.collect()),
            StoreUseSelection::ActiveForSelected | StoreUseSelection::AllForSelected => {
                let effective = self
                    .clone()
                    .sync_selection(selection)
                    .effective_fixture_selection();
                normalize_effects(
                    effects
                        .filter_map(|effect| effect.retain_fixtures(&effective.fixture_ids))
                        .collect(),
                )
            }
        }
    }

    pub fn clear(
        mut self,
        target: ProgrammerClearTarget,
        selection_has_fixtures: bool,
    ) -> ProgrammerClearResult {
        let resolved = match target {
            ProgrammerClearTarget::Contextual if selection_has_fixtures => {
                ProgrammerClearedLevel::Selection
            }
            ProgrammerClearTarget::Contextual if self.active_buffer().has_active_values() => {
                ProgrammerClearedLevel::Active
            }
            ProgrammerClearTarget::Contextual if self.active_buffer().has_values() => {
                ProgrammerClearedLevel::All
            }
            ProgrammerClearTarget::Contextual => ProgrammerClearedLevel::None,
            ProgrammerClearTarget::Selection => ProgrammerClearedLevel::Selection,
            ProgrammerClearTarget::Active => ProgrammerClearedLevel::Active,
            ProgrammerClearTarget::All => ProgrammerClearedLevel::All,
        };

        match resolved {
            ProgrammerClearedLevel::Selection => {
                self.selection.clear();
                self.bump_version();
                ProgrammerClearResult {
                    programmer: self,
                    clear_selection: true,
                    cleared_level: resolved,
                }
            }
            ProgrammerClearedLevel::Active => {
                self.active_buffer_mut().deactivate_active_values();
                self.bump_version();
                ProgrammerClearResult {
                    programmer: self,
                    clear_selection: false,
                    cleared_level: resolved,
                }
            }
            ProgrammerClearedLevel::All => {
                self.active_buffer_mut().clear_values();
                self.bump_version();
                ProgrammerClearResult {
                    programmer: self,
                    clear_selection: false,
                    cleared_level: resolved,
                }
            }
            ProgrammerClearedLevel::None => ProgrammerClearResult {
                programmer: self,
                clear_selection: false,
                cleared_level: resolved,
            },
        }
    }

    pub fn set_mode(mut self, mode: ProgrammerMode) -> Self {
        self.mode = mode;
        self.bump_version();
        self
    }

    pub fn set_blind(mut self, blind: bool) -> Self {
        self.blind = blind;
        self.bump_version();
        self
    }

    pub fn select_part(mut self, part_id: u16, label: Option<String>) -> ProgrammerResult<Self> {
        let buffer = self.active_buffer_mut();
        buffer.ensure_part(part_id)?;
        if let Some(part) = buffer.parts.iter_mut().find(|part| part.id == part_id) {
            if label.is_some() {
                part.label = label;
            }
        }
        buffer.selected_part_id = part_id;
        self.bump_version();
        Ok(self)
    }

    pub fn store_values(
        &self,
        use_selection: StoreUseSelection,
        selection: &FixtureSelection,
    ) -> Vec<ProgrammerValue> {
        let effective_selection = self
            .clone()
            .sync_selection(selection)
            .effective_fixture_selection();
        let values = self.active_buffer().values();
        values
            .into_iter()
            .filter(|value| match use_selection {
                StoreUseSelection::Active => value.active,
                StoreUseSelection::ActiveForSelected => {
                    value.active && effective_selection.fixture_ids.contains(&value.fixture_id)
                }
                StoreUseSelection::All => true,
                StoreUseSelection::AllForSelected => {
                    effective_selection.fixture_ids.contains(&value.fixture_id)
                }
            })
            .cloned()
            .collect()
    }

    fn active_buffer(&self) -> &ProgrammerBuffer {
        match self.mode {
            ProgrammerMode::Live => &self.live,
            ProgrammerMode::Preview => &self.preview,
        }
    }

    fn active_buffer_mut(&mut self) -> &mut ProgrammerBuffer {
        match self.mode {
            ProgrammerMode::Live => &mut self.live,
            ProgrammerMode::Preview => &mut self.preview,
        }
    }

    fn bump_version(&mut self) {
        self.version = self.version.saturating_add(1);
    }
}

impl ProgrammerAdjustAttributeRequest {
    fn adjusted_value(&self, current: f64) -> ProgrammerScalar {
        let lower = self.attribute.to_ascii_lowercase();
        if self.value_kind.eq_ignore_ascii_case("angle")
            || lower.contains("pan")
            || lower.contains("tilt")
            || lower.contains("rotate")
            || lower.contains("rot")
        {
            let min = self.min_value.unwrap_or(-180.0);
            let max = self.max_value.unwrap_or(180.0);
            let value = clamp(current + self.delta * 0.5, min.min(max), min.max(max));
            return ProgrammerScalar {
                numeric: Some(round_to(value, 1)),
                text: None,
            };
        }

        if self.value_kind.eq_ignore_ascii_case("range") {
            let min = self.min_value.unwrap_or(0.0);
            let max = self.max_value.unwrap_or(255.0);
            let span = (max - min).abs().max(1.0);
            let value = clamp(
                current + (self.delta / 360.0) * span,
                min.min(max),
                min.max(max),
            );
            return ProgrammerScalar {
                numeric: Some(value.round()),
                text: None,
            };
        }

        let value = clamp(current + self.delta / 3.6, 0.0, 100.0);
        ProgrammerScalar {
            numeric: Some(value.round()),
            text: None,
        }
    }

    fn default_numeric(&self) -> f64 {
        if let Some(value) = self.default_value.filter(|value| value.is_finite()) {
            return value;
        }

        let lower = self.attribute.to_ascii_lowercase();
        if self.value_kind.eq_ignore_ascii_case("angle")
            || lower.contains("pan")
            || lower.contains("tilt")
            || lower.contains("rotate")
            || lower.contains("rot")
        {
            return 0.0;
        }

        self.min_value.unwrap_or(0.0)
    }
}

impl ProgrammerSelectionContext {
    pub fn with_fixture_selection(mut self, selection: &FixtureSelection) -> Self {
        let previous = self.order;
        self.order = selection
            .fixture_ids
            .iter()
            .enumerate()
            .map(|(index, fixture_id)| {
                let grid = previous
                    .iter()
                    .find(|item| item.fixture_id == *fixture_id)
                    .map(|item| item.grid)
                    .unwrap_or(GridPosition {
                        x: index as i32,
                        y: 0,
                        z: 0,
                    });
                SelectionItem {
                    fixture_id: fixture_id.clone(),
                    order_index: index,
                    grid,
                }
            })
            .collect();
        self.primary_fixture_id = selection
            .primary_fixture_id
            .clone()
            .filter(|id| self.order.iter().any(|item| item.fixture_id == *id))
            .or_else(|| self.order.first().map(|item| item.fixture_id.clone()));
        self.cursor = self.cursor.min(self.order.len().saturating_sub(1));
        self
    }

    pub fn effective_fixture_ids(&self) -> Vec<String> {
        if self.order.is_empty() {
            return Vec::new();
        }

        let mut ordered = self.order.clone();
        ordered.sort_by_key(|item| item.order_index);
        if let Some(seed) = self.matricks.shuffle_seed {
            deterministic_shuffle(&mut ordered, seed);
        }

        if !self.matricks.active {
            return ordered.into_iter().map(|item| item.fixture_id).collect();
        }

        let groups = self.matricks.x.groups.max(1) as usize;
        let block = self.matricks.x.blocks.max(1) as usize;
        let index = wrap_index(self.matricks.x.index, groups);
        let shifted = self.matricks.x.shift;
        let inverted = self.matricks.x.invert;

        ordered
            .into_iter()
            .enumerate()
            .filter(|(position, _)| {
                let logical = ((*position / block) as i32 + shifted).rem_euclid(groups as i32);
                let logical = if inverted {
                    groups as i32 - 1 - logical
                } else {
                    logical
                };
                logical as usize == index
            })
            .map(|(_, item)| item.fixture_id)
            .collect()
    }

    pub fn apply_tool(mut self, tool: SelectionTool) -> Self {
        match tool {
            SelectionTool::Previous => {
                self.matricks.active = true;
                self.matricks.x.index -= 1;
            }
            SelectionTool::Next => {
                self.matricks.active = true;
                self.matricks.x.index += 1;
            }
            SelectionTool::Set => {
                self.matricks.active = !self.matricks.active;
                self.matricks.x.index = 0;
            }
            SelectionTool::ResetMatricks => {
                self.matricks = SelectionMatricks::default();
            }
            SelectionTool::LinearizeNumerical => {
                self.order
                    .sort_by_key(|item| natural_sort_key(&item.fixture_id));
                for (index, item) in self.order.iter_mut().enumerate() {
                    item.order_index = index;
                    item.grid = GridPosition {
                        x: index as i32,
                        y: 0,
                        z: 0,
                    };
                }
            }
            SelectionTool::LinearizeGridLeftToRight => {
                self.order
                    .sort_by_key(|item| (item.grid.y, item.grid.x, item.grid.z));
                for (index, item) in self.order.iter_mut().enumerate() {
                    item.order_index = index;
                }
            }
            SelectionTool::TransposeGrid => {
                for item in &mut self.order {
                    std::mem::swap(&mut item.grid.x, &mut item.grid.y);
                }
            }
            SelectionTool::MirrorX => mirror_axis(&mut self.order, Axis::X),
            SelectionTool::MirrorY => mirror_axis(&mut self.order, Axis::Y),
            SelectionTool::MirrorZ => mirror_axis(&mut self.order, Axis::Z),
            SelectionTool::Shuffle { seed } => {
                self.matricks.shuffle_seed = Some(seed);
            }
            SelectionTool::ToggleGridSetup => {
                self.grid.setup_mode = !self.grid.setup_mode;
            }
        }
        self
    }

    pub fn clear(&mut self) {
        self.order.clear();
        self.primary_fixture_id = None;
        self.cursor = 0;
        self.matricks = SelectionMatricks::default();
    }
}

impl ProgrammerBuffer {
    fn ensure_part(&mut self, part_id: u16) -> ProgrammerResult<&mut ProgrammerPart> {
        if part_id >= MAX_PROGRAMMER_PARTS {
            return Err(ProgrammerError::InvalidPart(part_id));
        }
        if !self.parts.iter().any(|part| part.id == part_id) {
            self.parts.push(ProgrammerPart {
                id: part_id,
                label: None,
                values: Vec::new(),
            });
            self.parts.sort_by_key(|part| part.id);
        }
        Ok(self
            .parts
            .iter_mut()
            .find(|part| part.id == part_id)
            .expect("part was just inserted"))
    }

    fn values(&self) -> impl Iterator<Item = &ProgrammerValue> {
        self.parts.iter().flat_map(|part| part.values.iter())
    }

    fn has_values(&self) -> bool {
        self.values().next().is_some() || self.has_effects()
    }

    fn has_active_values(&self) -> bool {
        self.values().any(|value| value.active)
    }

    fn deactivate_active_values(&mut self) {
        for part in &mut self.parts {
            for value in &mut part.values {
                value.active = false;
            }
        }
    }

    fn clear_values(&mut self) {
        self.parts.clear();
        self.selected_part_id = 0;
        // 效果和值同属 programmer 的内容，Clear 不能只清掉一半。
        self.effects.clear();
    }

    fn has_effects(&self) -> bool {
        self.effects.iter().any(AppliedEffect::has_output)
    }
}

impl ProgrammerPart {
    fn upsert_value(&mut self, value: ProgrammerValue) {
        if let Some(existing) = self.values.iter_mut().find(|existing| {
            existing.fixture_id == value.fixture_id
                && existing.attribute == value.attribute
                && existing.layer == value.layer
        }) {
            *existing = value;
        } else {
            self.values.push(value);
        }
    }
}

#[derive(Clone, Copy)]
enum Axis {
    X,
    Y,
    Z,
}

fn mirror_axis(items: &mut [SelectionItem], axis: Axis) {
    if items.is_empty() {
        return;
    }

    let values: Vec<i32> = items
        .iter()
        .map(|item| match axis {
            Axis::X => item.grid.x,
            Axis::Y => item.grid.y,
            Axis::Z => item.grid.z,
        })
        .collect();
    let min = values.iter().copied().min().unwrap_or(0);
    let max = values.iter().copied().max().unwrap_or(0);

    for item in items {
        let value = match axis {
            Axis::X => &mut item.grid.x,
            Axis::Y => &mut item.grid.y,
            Axis::Z => &mut item.grid.z,
        };
        *value = max - (*value - min);
    }
}

fn deterministic_shuffle(items: &mut [SelectionItem], seed: u64) {
    let mut state = seed.max(1);
    for index in (1..items.len()).rev() {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
        let swap_index = (state as usize) % (index + 1);
        items.swap(index, swap_index);
    }
}

fn natural_sort_key(value: &str) -> (u64, String) {
    let digits: String = value.chars().filter(|char| char.is_ascii_digit()).collect();
    (
        digits.parse::<u64>().unwrap_or(u64::MAX),
        value.to_ascii_lowercase(),
    )
}

fn wrap_index(index: i32, len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    index.rem_euclid(len as i32) as usize
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.min(max).max(min)
}

fn round_to(value: f64, places: i32) -> f64 {
    let factor = 10_f64.powi(places);
    (value * factor).round() / factor
}

fn validate_attribute(attribute: &str) -> ProgrammerResult<()> {
    if attribute.trim().is_empty() {
        return Err(ProgrammerError::InvalidAttribute(attribute.to_string()));
    }
    Ok(())
}

fn default_if_empty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value.trim()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_attribute_creates_active_values_for_selection() {
        let selection = fixture_selection(["a", "b"]);

        let programmer = Programmer::default()
            .set_attribute_for_selection(
                &selection,
                ProgrammerSetAttributeRequest {
                    attribute: "Dimmer".to_string(),
                    feature_group: "Dimmer".to_string(),
                    layer: ProgrammerLayer::Absolute,
                    value: ProgrammerScalar {
                        numeric: Some(100.0),
                        text: Some("100%".to_string()),
                    },
                    source: ProgrammerValueSource::Manual,
                },
            )
            .unwrap();

        assert_eq!(programmer.live.parts[0].values.len(), 2);
        assert!(programmer.live.parts[0]
            .values
            .iter()
            .all(|value| value.active));
    }

    #[test]
    fn adjust_attribute_accumulates_delta_on_authoritative_value() {
        let selection = fixture_selection(["a"]);
        let programmer = Programmer::default()
            .adjust_attribute_for_selection(
                &selection,
                adjust_request("Dimmer", "Dimmer", 360.0, "percent", None, None),
            )
            .unwrap()
            .adjust_attribute_for_selection(
                &selection,
                adjust_request("Dimmer", "Dimmer", -360.0, "percent", None, None),
            )
            .unwrap();

        let value = programmer.live.parts[0].values[0].value.numeric.unwrap();
        assert_eq!(value, 0.0);
    }

    #[test]
    fn adjust_attribute_clamps_percent_to_zero() {
        let selection = fixture_selection(["a"]);
        let programmer = Programmer::default()
            .set_attribute_for_selection(
                &selection,
                ProgrammerSetAttributeRequest {
                    attribute: "Dimmer".to_string(),
                    feature_group: "Dimmer".to_string(),
                    layer: ProgrammerLayer::Absolute,
                    value: ProgrammerScalar {
                        numeric: Some(1.0),
                        text: None,
                    },
                    source: ProgrammerValueSource::Manual,
                },
            )
            .unwrap()
            .adjust_attribute_for_selection(
                &selection,
                adjust_request("Dimmer", "Dimmer", -360.0, "percent", None, None),
            )
            .unwrap();

        let value = programmer.live.parts[0].values[0].value.numeric.unwrap();
        assert_eq!(value, 0.0);
    }

    #[test]
    fn adjust_attribute_uses_physical_range_for_range_values() {
        let selection = fixture_selection(["a"]);
        let programmer = Programmer::default()
            .adjust_attribute_for_selection(
                &selection,
                adjust_request("Shutter1", "Strobe", 360.0, "range", Some(1.0), Some(20.0)),
            )
            .unwrap();

        let value = programmer.live.parts[0].values[0].value.numeric.unwrap();
        assert_eq!(value, 20.0);
    }

    #[test]
    fn contextual_clear_follows_selection_active_all_order() {
        let selection = fixture_selection(["a"]);
        let programmer = Programmer::default()
            .set_attribute_for_selection(
                &selection,
                ProgrammerSetAttributeRequest {
                    attribute: "Dimmer".to_string(),
                    feature_group: "Dimmer".to_string(),
                    layer: ProgrammerLayer::Absolute,
                    value: ProgrammerScalar {
                        numeric: Some(1.0),
                        text: None,
                    },
                    source: ProgrammerValueSource::Manual,
                },
            )
            .unwrap();

        let first = programmer
            .clone()
            .clear(ProgrammerClearTarget::Contextual, true);
        assert!(first.clear_selection);
        assert_eq!(first.cleared_level, ProgrammerClearedLevel::Selection);

        let second = programmer.clear(ProgrammerClearTarget::Contextual, false);
        assert_eq!(second.cleared_level, ProgrammerClearedLevel::Active);
        assert!(!second.programmer.live.parts[0].values[0].active);

        let third = second
            .programmer
            .clear(ProgrammerClearTarget::Contextual, false);
        assert_eq!(third.cleared_level, ProgrammerClearedLevel::All);
        assert!(third.programmer.live.parts.is_empty());
    }

    #[test]
    fn matricks_next_steps_through_interleaved_groups() {
        let mut programmer = Programmer::default()
            .sync_selection(&fixture_selection(["1", "2", "3", "4", "5", "6"]));
        programmer.selection.matricks.x.groups = 2;

        let first = programmer
            .clone()
            .apply_selection_tool(SelectionTool::Next)
            .effective_fixture_selection();
        assert_eq!(first.fixture_ids, vec!["2", "4", "6"]);

        let second = programmer
            .apply_selection_tool(SelectionTool::Previous)
            .effective_fixture_selection();
        assert_eq!(second.fixture_ids, vec!["2", "4", "6"]);
    }

    #[test]
    fn selection_grid_tools_transform_grid_without_losing_order() {
        let mut programmer =
            Programmer::default().sync_selection(&fixture_selection(["10", "2", "1"]));
        programmer.selection.order[0].grid = GridPosition { x: 1, y: 0, z: 0 };
        programmer.selection.order[1].grid = GridPosition { x: 0, y: 1, z: 0 };
        programmer.selection.order[2].grid = GridPosition { x: 2, y: 0, z: 0 };

        let programmer = programmer
            .apply_selection_tool(SelectionTool::LinearizeNumerical)
            .apply_selection_tool(SelectionTool::TransposeGrid);

        let ids: Vec<_> = programmer
            .selection
            .order
            .iter()
            .map(|item| item.fixture_id.as_str())
            .collect();
        assert_eq!(ids, vec!["1", "2", "10"]);
        assert_eq!(programmer.selection.order[2].grid.y, 2);
    }

    fn fixture_selection<const N: usize>(ids: [&str; N]) -> FixtureSelection {
        FixtureSelection {
            fixture_ids: ids.into_iter().map(str::to_string).collect(),
            primary_fixture_id: ids.first().map(|id| id.to_string()),
            version: 1,
        }
    }

    fn adjust_request(
        attribute: &str,
        feature_group: &str,
        delta: f64,
        value_kind: &str,
        min_value: Option<f64>,
        max_value: Option<f64>,
    ) -> ProgrammerAdjustAttributeRequest {
        ProgrammerAdjustAttributeRequest {
            attribute: attribute.to_string(),
            feature_group: feature_group.to_string(),
            layer: ProgrammerLayer::Absolute,
            delta,
            value_kind: value_kind.to_string(),
            min_value,
            max_value,
            default_value: None,
            source: ProgrammerValueSource::Manual,
        }
    }
}
