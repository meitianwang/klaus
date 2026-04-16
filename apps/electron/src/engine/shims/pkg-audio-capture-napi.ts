/**
 * Shim for audio-capture-napi (unavailable native module).
 */

export function isNativeAudioAvailable(): boolean {
  return false
}

export function isNativeRecordingActive(): boolean {
  return false
}

export async function startNativeRecording(..._args: any[]): Promise<Buffer> {
  throw new Error('Native audio capture is not available')
}

export async function stopNativeRecording(): Promise<Buffer> {
  throw new Error('Native audio capture is not available')
}

export default undefined
