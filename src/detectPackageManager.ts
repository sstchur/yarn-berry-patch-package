import fs from "fs-extra"
import { join } from "./path"
import chalk from "chalk"
import process from "process"
import findWorkspaceRoot from "find-yarn-workspace-root"

export type PackageManager = "yarn"

function printNoYarnLockfileError() {
  console.log(`
${chalk.red.bold("**ERROR**")} ${chalk.red(
    `No yarn.lock file found.

yarn-berry-patch-package requires Yarn v4+ with nodeLinker: node-modules.
Ensure you have a yarn.lock file in your project root or workspace root.`,
  )}
`)
}

export const detectPackageManager = (appRootPath: string): PackageManager => {
  const yarnLockExists = fs.existsSync(join(appRootPath, "yarn.lock"))
  if (yarnLockExists || findWorkspaceRoot()) {
    return "yarn"
  } else {
    printNoYarnLockfileError()
    process.exit(1)
  }
  throw Error()
}
