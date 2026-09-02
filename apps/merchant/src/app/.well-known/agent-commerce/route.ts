import { merchantManifest } from "../../../lib/catalog";

export function GET() {
  return Response.json(merchantManifest, {
    headers: {
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
    },
  });
}
