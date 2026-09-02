import { createHealthStatus } from "@mandate/shared";
import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(createHealthStatus("buyer"));
}
