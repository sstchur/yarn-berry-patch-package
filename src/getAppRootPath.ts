import { join, resolve } from "./path"
import process from "process"
import { existsSync } from "fs-extra"
import chalk from "chalk"

function validateNodeLinker(appRoot: string) {
  const pnpFile = join(appRoot, ".pnp.cjs")
  if (existsSync(pnpFile)) {
    console.error(chalk.red.bold("**ERROR**"))
    console.error(
      chalk.red(
        "yarn-berry-patch-package requires nodeLinker: node-modules\n\n" +
          "Add to .yarnrc.yml:\n  nodeLinker: node-modules\n\n" +
          "Then run: yarn install",
      ),
    )
    process.exit(1)
  }
}

export const getAppRootPath = (): string => {
  let cwd = process.cwd()
  while (!existsSync(join(cwd, "package.json"))) {
    const up = resolve(cwd, "../")
    if (up === cwd) {
      throw new Error("no package.json found for this project")
    }
    cwd = up
  }
  validateNodeLinker(cwd)
  return cwd
}
