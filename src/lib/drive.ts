/* Google Drive con cuenta de servicio (lee, y si la carpeta está compartida como Editor, ordena). GOOGLE_SERVICE_ACCOUNT_JSON en Vercel. */
import { JWT } from "google-auth-library";

export interface DriveFile { id: string; name: string; mimeType: string; size?: string; createdTime: string; modifiedTime: string; webViewLink?: string; parents?: string[]; shortcutDetails?: { targetId: string } }

let jwt: JWT | null = null;
function auth() {
  if (jwt) return jwt;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no configurado.");
  const sa = JSON.parse(raw);
  jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ["https://www.googleapis.com/auth/drive"] });
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
    if (!r.ok) throw new Error(`Drive list ${r.status} (carpeta «${folderId}»): ${(await r.text()).slice(0, 200)}`);
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

const hdr = async () => ({ Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" });

/** Subcarpeta por nombre (sin distinguir mayúsculas ni acentos); la crea si no existe. */
export async function ensureFolder(parentId: string, name: string, match?: RegExp): Promise<string> {
  const items = await listFolder(parentId);
  const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const f = items.find((i) => i.mimeType === "application/vnd.google-apps.folder" && (match ? match.test(i.name) : norm(i.name) === norm(name)));
  if (f) return f.id;
  const r = await fetch(`${API}/files?supportsAllDrives=true&fields=id`, { method: "POST", headers: await hdr(), body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }) });
  if (!r.ok) throw new Error(`Drive crear carpeta ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).id as string;
}

/** Mueve un archivo a otra carpeta (quita los padres actuales). */
export async function moveFile(fileId: string, toFolderId: string, fromParents: string[]): Promise<void> {
  const r = await fetch(`${API}/files/${fileId}?addParents=${toFolderId}&removeParents=${fromParents.join(",")}&supportsAllDrives=true&fields=id,parents`, { method: "PATCH", headers: await hdr(), body: "{}" });
  if (!r.ok) throw new Error(`Drive mover ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
