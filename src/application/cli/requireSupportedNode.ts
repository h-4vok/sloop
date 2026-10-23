export function requireSupportedNode(version: string): void {
  const major = Number(version.replace(/^v/, '').split('.')[0]);

  if (!Number.isInteger(major) || major < 22) {
    const unsupportedVersionMessage = `Sloop requires Node.js 22 or newer; current runtime is ${version}.`;
    throw new Error(unsupportedVersionMessage);
  }
}
