// electron-builder afterPack: the Intel Mac build leaves out the built-in voices. ONNX Runtime, which they run on,
// has no build for Intel Macs, so there Read aloud uses the Mac's own voices, and the files would only take space.
const { rm } = require('node:fs/promises');
const { join } = require('node:path');
const { Arch } = require('electron-builder');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' || context.arch !== Arch.x64) return;
  const resources = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources');
  await rm(join(resources, 'voices'), { recursive: true, force: true });
  await rm(join(resources, 'voice-data'), { recursive: true, force: true });
};
