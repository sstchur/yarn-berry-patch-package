import chalk from "chalk"
import console from "console"
import { renameSync } from "fs"
import {
  copySync,
  existsSync,
  mkdirpSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  removeSync,
  writeFileSync,
} from "fs-extra"
import { dirSync } from "tmp"
import { gzipSync } from "zlib"
import { applyPatch } from "./applyPatches"
import {
  getPackageVCSDetails,
  maybePrintIssueCreationPrompt,
  openIssueCreationLink,
  shouldRecommendIssue,
} from "./createIssue"
import { PackageManager } from "./detectPackageManager"
import { removeIgnoredFiles } from "./filterFiles"
import { getPackageResolution } from "./getPackageResolution"
import { getPackageVersion } from "./getPackageVersion"
import { hashFile } from "./hash"
import {
  getPatchDetailsFromCliString,
  PackageDetails,
  PatchedPackageDetails,
} from "./PackageDetails"
import { parsePatchFile } from "./patch/parse"
import { getGroupedPatches } from "./patchFs"
import { dirname, join, resolve } from "./path"
import { spawnSafeSync } from "./spawnSafe"
import {
  clearPatchApplicationState,
  getPatchApplicationState,
  PatchState,
  savePatchApplicationState,
  STATE_FILE_NAME,
  verifyAppliedPatches,
} from "./stateFile"

function printNoPackageFoundError(
  packageName: string,
  packageJsonPath: string,
) {
  console.log(
    `No such package ${packageName}

  File not found: ${packageJsonPath}`,
  )
}

export function makePatch({
  packagePathSpecifier,
  appPath,
  packageManager,
  includePaths,
  excludePaths,
  patchDir,
  createIssue,
  mode,
  manualPatchOptions,
}: {
  packagePathSpecifier: string
  appPath: string
  packageManager: PackageManager
  includePaths: RegExp
  excludePaths: RegExp
  patchDir: string
  createIssue: boolean
  mode: { type: "overwrite_last" } | { type: "append"; name?: string }
  manualPatchOptions?: { targetDir: string }
}) {
  const isManualPatch = !!manualPatchOptions

  let packageDetails: PackageDetails
  if (isManualPatch) {
    const targetPkgJsonPath = join(
      appPath,
      manualPatchOptions!.targetDir,
      "package.json",
    )
    if (!existsSync(targetPkgJsonPath)) {
      console.log(`No package.json found at ${targetPkgJsonPath}`)
      process.exit(1)
    }
    const targetPkg = JSON.parse(readFileSync(targetPkgJsonPath, "utf8"))
    const packageName: string = targetPkg.name
    if (!packageName) {
      console.log(`No "name" field in ${targetPkgJsonPath}`)
      process.exit(1)
    }
    packageDetails = {
      name: packageName,
      packageNames: [packageName],
      path: join("node_modules", packageName),
      pathSpecifier: packageName,
      humanReadablePathSpecifier: packageName,
      isNested: false,
    }
  } else {
    const details = getPatchDetailsFromCliString(packagePathSpecifier)
    if (!details) {
      console.log("No such package", packagePathSpecifier)
      return
    }
    packageDetails = details
  }

  let isRebasing = false
  let patchesToApplyBeforeDiffing: PatchedPackageDetails[] = []
  let existingPatches: PatchedPackageDetails[] = []
  let canCreateIssue = false
  let numPatchesAfterCreate = 1
  let state: ReturnType<typeof getPatchApplicationState> = null
  let vcs: ReturnType<typeof getPackageVCSDetails> | undefined

  if (!isManualPatch) {
    state = getPatchApplicationState(packageDetails)
    isRebasing = state?.isRebasing ?? false

    // If we are rebasing and no patches have been applied, --append is the only valid option because
    // there are no previous patches to overwrite/update
    if (
      isRebasing &&
      state?.patches.filter((p) => p.didApply).length === 0 &&
      mode.type === "overwrite_last"
    ) {
      mode = { type: "append", name: "initial" }
    }

    if (isRebasing && state) {
      verifyAppliedPatches({ appPath, patchDir, state })
    }

    if (
      mode.type === "overwrite_last" &&
      isRebasing &&
      state?.patches.length === 0
    ) {
      mode = { type: "append", name: "initial" }
    }

    existingPatches =
      getGroupedPatches(patchDir).pathSpecifierToPatchFiles[
        packageDetails.pathSpecifier
      ] || []

    // apply all existing patches if appending
    // otherwise apply all but the last
    const previouslyAppliedPatches = state?.patches.filter((p) => p.didApply)
    patchesToApplyBeforeDiffing = isRebasing
      ? mode.type === "append"
        ? existingPatches.slice(0, previouslyAppliedPatches!.length)
        : state!.patches[state!.patches.length - 1].didApply
        ? existingPatches.slice(0, previouslyAppliedPatches!.length - 1)
        : existingPatches.slice(0, previouslyAppliedPatches!.length)
      : mode.type === "append"
      ? existingPatches
      : existingPatches.slice(0, -1)

    if (createIssue && mode.type === "append") {
      console.log("--create-issue is not compatible with --append.")
      process.exit(1)
    }

    if (createIssue && isRebasing) {
      console.log("--create-issue is not compatible with rebasing.")
      process.exit(1)
    }

    numPatchesAfterCreate =
      mode.type === "append" || existingPatches.length === 0
        ? existingPatches.length + 1
        : existingPatches.length
    vcs = getPackageVCSDetails(packageDetails)
    canCreateIssue =
      !isRebasing &&
      shouldRecommendIssue(vcs) &&
      numPatchesAfterCreate === 1 &&
      mode.type !== "append"
  }

  const packagePath = isManualPatch
    ? join(appPath, manualPatchOptions!.targetDir)
    : join(appPath, packageDetails.path)
  const packageJsonPath = join(packagePath, "package.json")

  if (!existsSync(packageJsonPath)) {
    printNoPackageFoundError(packagePathSpecifier, packageJsonPath)
    process.exit(1)
  }

  const tmpRepo = dirSync({ unsafeCleanup: true })
  const tmpRepoPackagePath = join(tmpRepo.name, packageDetails.path)
  const tmpRepoNpmRoot = tmpRepoPackagePath.slice(
    0,
    -`/node_modules/${packageDetails.name}`.length,
  )

  try {
    const patchesDir = isManualPatch
      ? resolve(join(appPath, patchDir, "manually-applied-patches"))
      : resolve(join(appPath, patchDir))

    console.info(chalk.grey("•"), "Creating temporary folder")

    // Create the directory where the package will be extracted
    mkdirpSync(tmpRepoPackagePath)

    const packageVersion = isManualPatch
      ? getPackageVersion(
          join(resolve(manualPatchOptions!.targetDir), "package.json"),
        )
      : getPackageVersion(join(resolve(packageDetails.path), "package.json"))

    // Copy .npmrc in case packages are hosted in private registry
    const npmrcPath = join(appPath, ".npmrc")
    if (existsSync(npmrcPath)) {
      copySync(npmrcPath, join(tmpRepo.name, ".npmrc"), { dereference: true })
    }

    console.info(
      chalk.grey("•"),
      `Fetching ${packageDetails.name}@${packageVersion} with npm`,
    )
    // Use npm pack to download ONLY the package tarball — no transitive deps.
    let packageResolution: string
    if (isManualPatch) {
      packageResolution = packageVersion
    } else {
      packageResolution =
        getPackageResolution({
          packageDetails,
          packageManager,
          appPath,
        }) ?? packageVersion
    }
    const packSpec = packageResolution.startsWith("file:")
      ? packageResolution.slice(5)
      : `${packageDetails.name}@${packageResolution}`

    const npmPackResult = spawnSafeSync(
      `npm`,
      ["pack", packSpec, "--pack-destination", tmpRepoNpmRoot],
      {
        cwd: tmpRepo.name,
        logStdErrOnError: false,
        throwOnError: false,
      },
    )

    if (npmPackResult.status !== 0) {
      console.error(`Failed to fetch ${packageDetails.name}@${packageVersion}`)
      if (npmPackResult.stderr) {
        console.error(npmPackResult.stderr.toString())
      }
      throw npmPackResult
    }

    // npm pack prints the tarball filename to stdout
    const tarballFilename = npmPackResult.stdout.toString().trim()
    const tarballPath = join(tmpRepoNpmRoot, tarballFilename)

    // Extract the tarball. npm tarballs always have a top-level "package/"
    // directory, so --strip-components=1 extracts contents directly.
    spawnSafeSync(
      `tar`,
      ["xzf", tarballPath, "-C", tmpRepoPackagePath, "--strip-components=1"],
      {
        logStdErrOnError: true,
      },
    )

    // Clean up the tarball
    removeSync(tarballPath)

    const git = (...args: string[]) =>
      spawnSafeSync("git", args, {
        cwd: tmpRepo.name,
        env: { ...process.env, HOME: tmpRepo.name },
        maxBuffer: 1024 * 1024 * 100,
      })

    // remove nested node_modules just to be safe
    removeSync(join(tmpRepoPackagePath, "node_modules"))
    // remove .git just to be safe
    removeSync(join(tmpRepoPackagePath, ".git"))
    // remove patch-package state file
    removeSync(join(tmpRepoPackagePath, STATE_FILE_NAME))

    // commit the package
    console.info(chalk.grey("•"), "Diffing your files with clean files")
    writeFileSync(join(tmpRepo.name, ".gitignore"), "!/node_modules\n\n")
    git("init")
    git("config", "--local", "user.name", "patch-package")
    git("config", "--local", "user.email", "patch@pack.age")

    // remove ignored files first
    removeIgnoredFiles(tmpRepoPackagePath, includePaths, excludePaths)

    for (const patchDetails of patchesToApplyBeforeDiffing) {
      if (
        !applyPatch({
          patchDetails,
          patchDir,
          patchFilePath: join(appPath, patchDir, patchDetails.patchFilename),
          reverse: false,
          cwd: tmpRepo.name,
          bestEffort: false,
        })
      ) {
        // TODO: add better error message once --rebase is implemented
        console.log(
          `Failed to apply patch ${patchDetails.patchFilename} to ${packageDetails.pathSpecifier}`,
        )
        process.exit(1)
      }
    }
    git("add", "-f", packageDetails.path)
    git("commit", "--allow-empty", "-m", "init")

    // replace package with user's version
    removeSync(tmpRepoPackagePath)

    // pnpm installs packages as symlinks, copySync would copy only the symlink
    copySync(realpathSync(packagePath), tmpRepoPackagePath)

    // remove nested node_modules just to be safe
    removeSync(join(tmpRepoPackagePath, "node_modules"))
    // remove .git just to be safe
    removeSync(join(tmpRepoPackagePath, ".git"))
    // remove patch-package state file
    removeSync(join(tmpRepoPackagePath, STATE_FILE_NAME))

    // also remove ignored files like before
    removeIgnoredFiles(tmpRepoPackagePath, includePaths, excludePaths)

    // stage all files
    git("add", "-f", packageDetails.path)

    // get diff of changes
    const diffResult = git(
      "diff",
      "--cached",
      "--no-color",
      "--ignore-space-at-eol",
      "--no-ext-diff",
      "--src-prefix=a/",
      "--dst-prefix=b/",
    )

    if (diffResult.stdout.length === 0) {
      console.log(
        `⁉️  Not creating patch file for package '${packagePathSpecifier}'`,
      )
      console.log(`⁉️  There don't appear to be any changes.`)
      if (isRebasing && mode.type === "overwrite_last") {
        console.log(
          "\n💡 To remove a patch file, delete it and then reinstall node_modules from scratch.",
        )
      }
      process.exit(1)
      return
    }

    try {
      parsePatchFile(diffResult.stdout.toString())
    } catch (e) {
      if (
        (e as Error).message.includes("Unexpected file mode string: 120000")
      ) {
        console.log(`
⛔️ ${chalk.red.bold("ERROR")}

  Your changes involve creating symlinks. yarn-berry-patch-package does not yet support
  symlinks.

  ️Please use ${chalk.bold("--include")} and/or ${chalk.bold(
          "--exclude",
        )} to narrow the scope of your patch if
  this was unintentional.
`)
      } else {
        const outPath = "./patch-package-error.json.gz"
        writeFileSync(
          outPath,
          gzipSync(
            JSON.stringify({
              error: { message: e.message, stack: e.stack },
              patch: diffResult.stdout.toString(),
            }),
          ),
        )
        console.log(`
⛔️ ${chalk.red.bold("ERROR")}

  yarn-berry-patch-package was unable to read the patch-file made by git. This should not
  happen.

  A diagnostic file was written to

    ${outPath}

  Please attach it to a github issue

    https://github.com/sstchur/yarn-berry-patch-package/issues/new?title=New+patch+parse+failed&body=Please+attach+the+diagnostic+file+by+dragging+it+into+here+🙏

  Note that this diagnostic file will contain code from the package you were
  attempting to patch.

`)
      }
      process.exit(1)
      return
    }

    // In manualpatch mode, write the file and return early
    if (isManualPatch) {
      const manualPatchFileName = createManualPatchFileName({
        packageName: packageDetails.name,
        packageVersion,
      })
      const patchPath = join(patchesDir, manualPatchFileName)
      if (!existsSync(dirname(patchPath))) {
        mkdirpSync(dirname(patchPath))
      }
      writeFileSync(patchPath, diffResult.stdout)
      console.log(
        `${chalk.green("✔")} Created file ${join(
          patchDir,
          "manually-applied-patches",
          manualPatchFileName,
        )}\n`,
      )
      return
    }

    // maybe delete existing
    if (mode.type === "append" && !isRebasing && existingPatches.length === 1) {
      // if we are appending to an existing patch that doesn't have a sequence number let's rename it
      const prevPatch = existingPatches[0]
      if (prevPatch.sequenceNumber === undefined) {
        const newFileName = createPatchFileName({
          packageDetails,
          packageVersion,
          sequenceNumber: 1,
          sequenceName: prevPatch.sequenceName ?? "initial",
        })
        const oldPath = join(appPath, patchDir, prevPatch.patchFilename)
        const newPath = join(appPath, patchDir, newFileName)
        renameSync(oldPath, newPath)
        prevPatch.sequenceNumber = 1
        prevPatch.patchFilename = newFileName
        prevPatch.sequenceName = prevPatch.sequenceName ?? "initial"
      }
    }

    const lastPatch = existingPatches[
      state ? state.patches.length - 1 : existingPatches.length - 1
    ] as PatchedPackageDetails | undefined
    const sequenceName =
      mode.type === "append" ? mode.name : lastPatch?.sequenceName
    const sequenceNumber =
      mode.type === "append"
        ? (lastPatch?.sequenceNumber ?? 0) + 1
        : lastPatch?.sequenceNumber

    const patchFileName = createPatchFileName({
      packageDetails,
      packageVersion,
      sequenceName,
      sequenceNumber,
    })

    const patchPath: string = join(patchesDir, patchFileName)
    if (!existsSync(dirname(patchPath))) {
      // scoped package
      mkdirSync(dirname(patchPath))
    }

    // if we are inserting a new patch into a sequence we most likely need to update the sequence numbers
    if (isRebasing && mode.type === "append") {
      const patchesToNudge = existingPatches.slice(state!.patches.length)
      if (sequenceNumber === undefined) {
        throw new Error("sequenceNumber is undefined while rebasing")
      }
      if (
        patchesToNudge[0]?.sequenceNumber !== undefined &&
        patchesToNudge[0].sequenceNumber <= sequenceNumber
      ) {
        let next = sequenceNumber + 1
        for (const p of patchesToNudge) {
          const newName = createPatchFileName({
            packageDetails,
            packageVersion,
            sequenceName: p.sequenceName,
            sequenceNumber: next++,
          })
          console.log(
            "Renaming",
            chalk.bold(p.patchFilename),
            "to",
            chalk.bold(newName),
          )
          const oldPath = join(appPath, patchDir, p.patchFilename)
          const newPath = join(appPath, patchDir, newName)
          renameSync(oldPath, newPath)
        }
      }
    }

    writeFileSync(patchPath, diffResult.stdout)
    console.log(
      `${chalk.green("✔")} Created file ${join(patchDir, patchFileName)}\n`,
    )

    const prevState: PatchState[] = patchesToApplyBeforeDiffing.map(
      (p): PatchState => ({
        patchFilename: p.patchFilename,
        didApply: true,
        patchContentHash: hashFile(join(appPath, patchDir, p.patchFilename)),
      }),
    )
    const nextState: PatchState[] = [
      ...prevState,
      {
        patchFilename: patchFileName,
        didApply: true,
        patchContentHash: hashFile(patchPath),
      },
    ]

    // if any patches come after this one we just made, we should reapply them
    let didFailWhileFinishingRebase = false
    if (isRebasing) {
      const currentPatches = getGroupedPatches(join(appPath, patchDir))
        .pathSpecifierToPatchFiles[packageDetails.pathSpecifier]

      const previouslyUnappliedPatches = currentPatches.slice(nextState.length)
      if (previouslyUnappliedPatches.length) {
        console.log(`Fast forwarding...`)
        for (const patch of previouslyUnappliedPatches) {
          const patchFilePath = join(appPath, patchDir, patch.patchFilename)
          if (
            !applyPatch({
              patchDetails: patch,
              patchDir,
              patchFilePath,
              reverse: false,
              cwd: process.cwd(),
              bestEffort: false,
            })
          ) {
            didFailWhileFinishingRebase = true
            logPatchSequenceError({ patchDetails: patch })
            nextState.push({
              patchFilename: patch.patchFilename,
              didApply: false,
              patchContentHash: hashFile(patchFilePath),
            })
            break
          } else {
            console.log(`  ${chalk.green("✔")} ${patch.patchFilename}`)
            nextState.push({
              patchFilename: patch.patchFilename,
              didApply: true,
              patchContentHash: hashFile(patchFilePath),
            })
          }
        }
      }
    }

    if (isRebasing || numPatchesAfterCreate > 1) {
      savePatchApplicationState({
        packageDetails,
        patches: nextState,
        isRebasing: didFailWhileFinishingRebase,
      })
    } else {
      clearPatchApplicationState(packageDetails)
    }

    if (canCreateIssue) {
      if (createIssue) {
        openIssueCreationLink({
          packageDetails,
          patchFileContents: diffResult.stdout.toString(),
          packageVersion,
          patchPath,
        })
      } else {
        maybePrintIssueCreationPrompt(vcs!, packageDetails)
      }
    }
  } catch (e) {
    console.log(e)
    throw e
  } finally {
    tmpRepo.removeCallback()
  }
}

function createPatchFileName({
  packageDetails,
  packageVersion,
  sequenceNumber,
  sequenceName,
}: {
  packageDetails: PackageDetails
  packageVersion: string
  sequenceNumber?: number
  sequenceName?: string
}) {
  const packageNames = packageDetails.packageNames
    .map((name) => name.replace(/\//g, "+"))
    .join("++")

  const nameAndVersion = `${packageNames}+${packageVersion}`
  const num =
    sequenceNumber === undefined
      ? ""
      : `+${sequenceNumber.toString().padStart(3, "0")}`
  const name = !sequenceName ? "" : `+${sequenceName}`

  return `${nameAndVersion}${num}${name}.patch`
}

function createManualPatchFileName({
  packageName,
  packageVersion,
}: {
  packageName: string
  packageVersion: string
}) {
  const sanitizedName = packageName.replace(/\//g, "+")
  return `${sanitizedName}+${packageVersion}.manualpatch`
}

export function logPatchSequenceError({
  patchDetails,
}: {
  patchDetails: PatchedPackageDetails
}) {
  console.log(`
${chalk.red.bold("⛔ ERROR")}

Failed to apply patch file ${chalk.bold(patchDetails.patchFilename)}.

If this patch file is no longer useful, delete it and run

  ${chalk.bold(`yarn-berry-patch-package`)}

To partially apply the patch (if possible) and output a log of errors to fix, run

  ${chalk.bold(`yarn-berry-patch-package --partial`)}

After which you should make any required changes inside ${
    patchDetails.path
  }, and finally run

  ${chalk.bold(`yarn-berry-patch-package ${patchDetails.pathSpecifier}`)}

to update the patch file.
`)
}
