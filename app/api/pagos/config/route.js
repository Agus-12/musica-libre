import { NextResponse } from "next/server";
export async function GET() {
  const key = process.env.MP_PUBLIC_KEY || process.env.NEXT_PUBLIC_MP_PUBLIC_KEY || "";
  if (!key) return NextResponse.json({ error: "Falta MP_PUBLIC_KEY" }, { status: 500 });
  return NextResponse.json({ public_key: key });
}
