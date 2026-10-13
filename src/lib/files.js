import { base44 } from "@/api/base44Client";

export async function uploadPrivate(file, kind) {
  const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
  await base44.entities.Asset.create({ kind, name: file.name, file_uri, size: file.size });
  return file_uri;
}

export async function signedUrl(file_uri) {
  const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({ file_uri, expires_in: 3600 });
  return signed_url;
}