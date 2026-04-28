import { NativeModules } from 'react-native';

type UpdateModuleType = {
  getVersionCode(): Promise<number>;
  getVersionName(): Promise<string>;
  canInstallApks(): Promise<boolean>;
  openInstallSettings(): Promise<void>;
  installApk(filePath: string): Promise<void>;
};

const { UpdateModule } = NativeModules as { UpdateModule?: UpdateModuleType };

function ensureModule(): UpdateModuleType {
  if (!UpdateModule) {
    throw new Error(
      '[apkInstaller] UpdateModule not registered — check MainApplication.getPackages()',
    );
  }
  return UpdateModule;
}

export async function getLocalVersionCode(): Promise<number> {
  return ensureModule().getVersionCode();
}

export async function getLocalVersionName(): Promise<string> {
  return ensureModule().getVersionName();
}

export async function canInstallApks(): Promise<boolean> {
  try {
    return await ensureModule().canInstallApks();
  } catch (err) {
    console.warn('[apkInstaller] canInstallApks failed', err);
    return false;
  }
}

export async function openInstallSettings(): Promise<void> {
  return ensureModule().openInstallSettings();
}

export async function installApk(filePath: string): Promise<void> {
  return ensureModule().installApk(filePath);
}
