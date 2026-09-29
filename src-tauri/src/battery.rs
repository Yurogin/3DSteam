//! Niveau de batterie de l'ordinateur, affiché dans la barre du haut façon 3DS.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Battery {
    /// 0 à 100.
    pub percent: u8,
    /// Secteur branché.
    pub charging: bool,
}

#[cfg(windows)]
pub fn status() -> Option<Battery> {
    use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

    const NO_SYSTEM_BATTERY: u8 = 128;
    const UNKNOWN: u8 = 255;

    // SAFETY : la structure est entièrement initialisée par l'appel en cas de succès.
    let mut s: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
    if unsafe { GetSystemPowerStatus(&mut s) } == 0 {
        return None;
    }
    if s.BatteryFlag & NO_SYSTEM_BATTERY != 0 || s.BatteryFlag == UNKNOWN || s.BatteryLifePercent > 100 {
        return None;
    }
    Some(Battery {
        percent: s.BatteryLifePercent,
        charging: s.ACLineStatus == 1,
    })
}

#[cfg(not(windows))]
pub fn status() -> Option<Battery> {
    None
}
