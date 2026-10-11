import { NextResponse } from 'next/server';

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}
