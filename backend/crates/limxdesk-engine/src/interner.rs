// ============================================================
// 文件名称：interner.rs
// 功能描述：fixture / attribute 名称的字符串驻留
//
// 渲染路径上每个值都要按 (fixture, attribute) 寻址。早先的实现用
// format!("{}:{}:{:?}") 拼出字符串当哈希键，等于每个值每帧一次堆分配。
// 这里在编译期把名称换成 u32，运行时的键就是一对整数。
// ============================================================

use std::collections::HashMap;

/// 驻留后的符号。仅在产生它的 [`Interner`] 内有意义。
pub type SymbolId = u32;

/// 一个值在渲染中的地址。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ValueKey {
    pub fixture: SymbolId,
    pub attribute: SymbolId,
}

/// 名称 ↔ 符号的双向表。
#[derive(Clone, Debug, Default)]
pub struct Interner {
    lookup: HashMap<String, SymbolId>,
    names: Vec<String>,
}

impl Interner {
    pub fn new() -> Self {
        Self::default()
    }

    /// 取得名称对应的符号，必要时新建。
    pub fn intern(&mut self, name: &str) -> SymbolId {
        if let Some(id) = self.lookup.get(name) {
            return *id;
        }
        let id = self.names.len() as SymbolId;
        self.names.push(name.to_string());
        self.lookup.insert(name.to_string(), id);
        id
    }

    /// 查已有符号，不新建。
    pub fn get(&self, name: &str) -> Option<SymbolId> {
        self.lookup.get(name).copied()
    }

    /// 还原符号对应的名称。越界时返回空串，让渲染跳过该值而不是 panic。
    pub fn resolve(&self, id: SymbolId) -> &str {
        self.names.get(id as usize).map(String::as_str).unwrap_or("")
    }

    pub fn len(&self) -> usize {
        self.names.len()
    }

    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interning_the_same_name_yields_the_same_symbol() {
        let mut interner = Interner::new();
        let first = interner.intern("Dimmer");
        let second = interner.intern("Dimmer");
        let other = interner.intern("Pan");

        assert_eq!(first, second);
        assert_ne!(first, other);
        assert_eq!(interner.len(), 2);
    }

    #[test]
    fn symbols_resolve_back_to_names() {
        let mut interner = Interner::new();
        let id = interner.intern("Pan");

        assert_eq!(interner.resolve(id), "Pan");
        assert_eq!(interner.get("Pan"), Some(id));
        assert_eq!(interner.get("Tilt"), None);
    }

    #[test]
    fn unknown_symbols_resolve_to_empty_rather_than_panicking() {
        let interner = Interner::new();
        assert_eq!(interner.resolve(42), "");
    }
}
