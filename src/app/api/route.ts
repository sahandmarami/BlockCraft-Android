import { NextResponse } from "next/server";

// force-static → also allowed inside `output: export` builds (APK packaging)
export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json({ message: "Hello, world!" });
}