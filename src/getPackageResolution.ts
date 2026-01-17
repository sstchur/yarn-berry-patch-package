import { join, resolve } from "./path"
import { PackageDetails, getPatchDetailsFromCliString } from "./PackageDetails"
import { PackageManager, detectPackageManager } from "./detectPackageManager"
import { readFileSync, existsSync } from "fs-extra"
import yaml from "yaml"
import findWorkspaceRoot from "find-yarn-workspace-root"
import { getPackageVersion } from "./getPackageVersion"
import { coerceSemVer } from "./coerceSemVer"

export function getPackageResolution({
  packageDetails,
  appPath,
}: {
  packageDetails: PackageDetails
  packageManager?: PackageManager
  appPath: string
}) {
  let lockFilePath = "yarn.lock"
  if (!existsSync(lockFilePath)) {
    const workspaceRoot = findWorkspaceRoot()
    if (!workspaceRoot) {
      throw new Error("Can't find yarn.lock file")
    }
    lockFilePath = join(workspaceRoot, "yarn.lock")
  }
  if (!existsSync(lockFilePath)) {
    throw new Error("Can't find yarn.lock file")
  }
  const lockFileString = readFileSync(lockFilePath).toString()
  if (lockFileString.includes("yarn lockfile v1")) {
    throw new Error(
      "yarn-berry-patch-package requires Yarn v4+ (berry) lockfile format.\n\n" +
        "Your yarn.lock appears to be from Yarn v1. Please upgrade to Yarn v4+:\n" +
        "  1. Install Yarn v4: corepack enable && yarn set version stable\n" +
        "  2. Run: yarn install\n" +
        "  3. Try again",
    )
  }
  let appLockFile
  try {
    appLockFile = yaml.parse(lockFileString)
  } catch (e) {
    console.log(e)
    throw new Error("Could not parse Yarn v4 lock file")
  }

  const installedVersion = getPackageVersion(
    join(resolve(appPath, packageDetails.path), "package.json"),
  )

  const entries = Object.entries(appLockFile).filter(
    ([k, v]) =>
      k.startsWith(packageDetails.name + "@") &&
      // @ts-ignore
      coerceSemVer(v.version) === coerceSemVer(installedVersion),
  )

  if (entries.length === 0) {
    throw new Error(
      `\`${packageDetails.pathSpecifier}\`'s installed version is ${installedVersion} but a lockfile entry for it couldn't be found. Your lockfile is likely to be corrupt or you forgot to reinstall your packages.`,
    )
  }

  // For Yarn Berry lockfiles, we need to extract the resolution in a usable format
  // The lockfile entry key looks like: "@scope/package@npm:^1.0.0, @scope/package@npm:^1.1.0"
  // The resolution field looks like: "@scope/package@npm:1.2.3"
  // We want to return a version specifier that yarn can install

  const entry = entries[0]
  const entryValue = entry[1] as {
    version?: string
    resolution?: string
    resolved?: string
  }
  const version = entryValue.version

  // Check for resolution field (Yarn Berry format)
  const resolution = entryValue.resolution

  if (resolution) {
    // Yarn Berry resolution format: "package@npm:version" or "package@patch:..." etc.
    // For npm packages, extract just the version
    const npmMatch = resolution.match(/@npm:(.+)$/)
    if (npmMatch) {
      return npmMatch[1]
    }

    // For file: or other protocols, return as-is but handle relative paths
    if (resolution.includes("@file:")) {
      const filePath = resolution.split("@file:")[1]
      if (filePath.startsWith(".")) {
        return `file:${resolve(appPath, filePath)}`
      }
      return `file:${filePath}`
    }

    // For patch: protocol, use the version
    if (resolution.includes("@patch:")) {
      return version
    }

    // For other cases, try to use the version
    return version
  }

  // Fallback: use the resolved URL if available (older format)
  if (entryValue.resolved) {
    return entryValue.resolved
  }

  // Last resort: use the installed version
  return installedVersion
}

if (require.main === module) {
  const packageDetails = getPatchDetailsFromCliString(process.argv[2])
  if (!packageDetails) {
    console.log(`Can't find package ${process.argv[2]}`)
    process.exit(1)
  }
  console.log(
    getPackageResolution({
      appPath: process.cwd(),
      packageDetails,
      packageManager: detectPackageManager(process.cwd()),
    }),
  )
}
