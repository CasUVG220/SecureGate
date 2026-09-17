//! Permisos de cámara del WebView, por plataforma.
//!
//! La captura como tal corre en el WebView (`getUserMedia`, ver
//! `src/hooks/useCamera.ts`); aquí sólo se resuelve que el sistema no la
//! bloquee antes de llegar a JavaScript:
//!
//! - **Windows (producción)**: WebView2 dispara `PermissionRequested` cuando
//!   la página pide la cámara. `wry` sólo auto-concede el portapapeles; sin
//!   handler, WebView2 muestra su propio diálogo "localhost quiere usar tu
//!   cámara" en cada arranque, que en una garita es un estorbo. Se concede
//!   aquí, y sólo para cámara: micrófono, ubicación, etc. siguen negados.
//!   No hay nada que declarar en `capabilities/`: el ACL de Tauri gobierna
//!   los comandos IPC, no los permisos del navegador embebido.
//! - **macOS (desarrollo)**: `wry` ya responde `Grant` a
//!   `requestMediaCapturePermission`; lo que hace falta es
//!   `NSCameraUsageDescription` en `src-tauri/Info.plist`, o TCC niega el
//!   acceso sin mostrar diálogo. Ese archivo lo embebe `tauri-codegen` en
//!   `tauri dev` y `tauri-bundler` en el .app.
//!
//! Independiente de esto, el frontend cae a captura manual si la cámara
//! falla por cualquier motivo.

use tauri::{AppHandle, Manager};

const VENTANA: &str = "main";

/// Registra el handler de permisos en la ventana principal. Se llama en
/// `setup`; en plataformas donde no hace falta no hace nada.
pub fn configurar(app: &AppHandle) {
    let Some(ventana) = app.get_webview_window(VENTANA) else {
        log::warn!("camera: no existe la ventana '{VENTANA}'");
        return;
    };
    if let Err(e) = ventana.with_webview(|webview| {
        #[cfg(windows)]
        conceder_camara_webview2(&webview);
        #[cfg(not(windows))]
        let _ = webview;
    }) {
        log::warn!("camera: no se pudo acceder al webview nativo: {e}");
    }
}

#[cfg(windows)]
fn conceder_camara_webview2(webview: &tauri::webview::PlatformWebview) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;

    // Out-param de todas las registraciones de eventos de WebView2 (es un i64).
    let mut token: i64 = 0;
    let resultado = unsafe {
        let core = match webview.controller().CoreWebView2() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("camera: CoreWebView2 no disponible: {e}");
                return;
            }
        };
        core.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                if kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                }
                Ok(())
            })),
            &mut token,
        )
    };
    match resultado {
        Ok(()) => log::info!("camera: permiso de cámara concedido en WebView2"),
        Err(e) => log::warn!("camera: no se pudo registrar PermissionRequested: {e}"),
    }
}
