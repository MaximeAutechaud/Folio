use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

/// Remplace le fichier SQLite de l'application par une sauvegarde.
///
/// Le remplacement se fait au niveau fichier et non en SQL : `tauri-plugin-sql`
/// ouvre un pool de plusieurs connexions, donc ni `ATTACH` ni `BEGIN/COMMIT` ne
/// survivent d'un appel `execute` au suivant — une restauration en SQL ne serait
/// pas atomique. La contrepartie est que l'appelant DOIT avoir fermé la base
/// avant (`close`) et rechargé la page après.
///
/// `db_file` est le nom du fichier (`folio.db` / `folio-dev.db`) ; le dossier est
/// résolu ici via `app_config_dir()` — c'est celui qu'utilise `tauri-plugin-sql`,
/// il ne faut pas le déduire côté TS.
///
/// Retourne le chemin de la copie de sécurité prise avant écrasement.
#[tauri::command]
async fn restore_database<R: Runtime>(
    app: AppHandle<R>,
    src_path: String,
    db_file: String,
) -> Result<String, String> {
    // Le nom de fichier vient du front : on refuse tout ce qui pourrait sortir
    // du dossier de l'application.
    if db_file.contains('/') || db_file.contains('\\') || db_file.contains("..") {
        return Err(format!("Nom de base invalide : {db_file}"));
    }

    let src = PathBuf::from(&src_path);

    let header = std::fs::read(&src)
        .map_err(|e| format!("Lecture de la sauvegarde impossible : {e}"))?
        .into_iter()
        .take(16)
        .collect::<Vec<u8>>();
    if header != b"SQLite format 3\0" {
        return Err("Ce fichier n'est pas une base SQLite.".into());
    }

    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Dossier applicatif introuvable : {e}"))?;
    let dest = dir.join(&db_file);

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let safety = dir.join(format!("{db_file}.pre-restore-{stamp}"));

    // Copie de sécurité de l'état courant avant écrasement — dernier filet si la
    // sauvegarde importée n'était pas celle que l'utilisateur croyait.
    if dest.exists() {
        std::fs::copy(&dest, &safety)
            .map_err(|e| format!("Copie de sécurité impossible, restauration annulée : {e}"))?;
    }

    std::fs::copy(&src, &dest).map_err(|e| format!("Écriture de la base impossible : {e}"))?;

    // Le WAL et l'index partagé décrivent l'ancienne base : les laisser en place
    // ferait lire à SQLite un mélange des deux.
    for suffix in ["-wal", "-shm"] {
        let side = dir.join(format!("{db_file}{suffix}"));
        if side.exists() {
            let _ = std::fs::remove_file(side);
        }
    }

    Ok(safety.to_string_lossy().to_string())
}

#[tauri::command]
async fn fetch_url(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    response.text().await.map_err(|e| e.to_string())
}

// POST vers l'API Anthropic (contourne le CORS de WebView2, comme fetch_url pour
// Yahoo). `body` est le JSON déjà sérialisé côté TS. Retourne le corps brut de la
// réponse (succès OU erreur JSON `{type:"error",...}`) — le parsing/statut est géré
// côté TS. La clé API ne transite jamais hors de ce process.
#[tauri::command]
async fn anthropic_message(api_key: String, body: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    response.text().await.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            fetch_url,
            anthropic_message,
            restore_database
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
