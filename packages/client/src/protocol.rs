use serde::{Deserialize, Serialize};

#[derive(Serialize, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClientMessage {
    Key { data: String },
    Mouse { seq: String },
    Resize { cols: u16, rows: u16 },
    Attach { version: String },
    Detach,
    Ping,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DaemonMessage {
    Frame {
        cells: Vec<CellUpdate>,
    },
    Ansi {
        data: String,
    },
    Ready {
        version: String,
    },
    Pong,
    Restart,
    Error {
        message: String,
        code: Option<String>,
    },
}

#[derive(Deserialize, Debug)]
pub struct CellUpdate {
    pub col: u16,
    pub row: u16,
    pub ch: String,
    pub fg: Option<String>,
    pub bg: Option<String>,
    pub bold: Option<bool>,
    pub dim: Option<bool>,
    pub italic: Option<bool>,
    pub underline: Option<bool>,
}

pub fn encode(msg: &ClientMessage) -> String {
    serde_json::to_string(msg).unwrap_or_else(|_| "{}".to_string()) + "\n"
}

pub fn decode_line(line: &str) -> Option<DaemonMessage> {
    serde_json::from_str(line).ok()
}
