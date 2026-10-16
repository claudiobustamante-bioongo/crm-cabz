/* Google Drive (solo lectura) con cuenta de servicio. GOOGLE_SERVICE_ACCOUNT_JSON en Vercel. */
import { JWT } from "google-auth-library";

export interface DriveFile { id: string; name: string; mimeType: string; size?: string; createdTime: string; modifiedTime: string; webViewLink?: string; parents?: string[]; shortcutDetails?: { targetId: string } }

let jwt: JWT | null = null;
function auth() {
  if (jwt) return jwt;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no configurado.");
  const sa = JSON.parse(raw);
  jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ["https://www.googleapis.com/auth/drive.readonly"] });
  return jwt;
}
async function token() { const t = await auth().getAccessToken(); if (!t.token) throw new Error("Sin token de Google."); return t.token; }

const API = "https://www.googleapis.com/drive/v3";
const FIELDS = "files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,parents,shortcutDetails),nextPageToken";

export async function listFolder(folderId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = []; let pageToken = "";
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const r = await fetch(`${API}/files?q=${q}&fields=${encodeURIComponent(FIELDS)}&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ""}`,
      { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
    if (!r.ok) throw new Error(`Drive list ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json(); out.push(...(j.files ?? [])); pageToken = j.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

/** Recorre recursivamente; devuelve archivos con su ruta de carpetas. */
export async function walk(folderId: string, path = "", skip: (name: string) => boolean = () => false): Promise<{ file: DriveFile; path: string }[]> {
  const items = await listFolder(folderId);
  const out: { file: DriveFile; path: string }[] = [];
  for (const f of items) {
    if (f.mimeType === "application/vnd.google-apps.folder") {
      if (!skip(f.name)) out.push(...await walk(f.id, path ? `${path}/${f.name}` : f.name, skip));
    } else out.push({ file: f, path });
  }
  return out;
}

export async function download(fileId: string): Promise<ArrayBuffer> {
  const r = await fetch(`${API}/files/${fileId}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
  if (!r.ok) throw new Error(`Drive download ${r.status}`);
  return r.arrayBuffer();
}
