# yarn-berry-patch-package

Fix broken node modules in Yarn v4+ projects with no fuss.

This is a fork of [patch-package](https://github.com/ds300/patch-package) specifically designed for **Yarn v4+ with `nodeLinker: node-modules`**.

```sh
# fix a bug in one of your dependencies
vim node_modules/some-package/brokenFile.js

# run yarn-berry-patch-package to create a .patch file
yarn yarn-berry-patch-package some-package

# commit the patch file to share the fix with your team
git add patches/some-package+3.14.15.patch
git commit -m "fix brokenFile.js in some-package"
```

Patches created by `yarn-berry-patch-package` are automatically and gracefully applied when you run `yarn install` (via a postinstall script).

## Requirements

- **Yarn v4+** with `nodeLinker: node-modules` in `.yarnrc.yml`
- Node.js >= 14
- npm (used internally for fetching original package tarballs)

This package does **not** support:

- npm-managed projects (use the original [patch-package](https://github.com/ds300/patch-package))
- Yarn v1 (use the original [patch-package](https://github.com/ds300/patch-package))
- Yarn PnP mode (use Yarn's native `yarn patch` command instead)

## Set-up

### 1. Configure Yarn

Ensure your `.yarnrc.yml` contains:

```yaml
nodeLinker: node-modules
```

### 2. Install

```sh
yarn add yarn-berry-patch-package
```

You can use `--dev` if you don't need to run yarn in production, e.g. if you're making a web frontend.

### 3. Add postinstall script

In `package.json`:

```diff
 "scripts": {
+  "postinstall": "yarn-berry-patch-package"
 }
```

### Private registries

If your packages come from a private registry, make sure you have an `.npmrc` file in your project root with the appropriate registry configuration and authentication. This file is used when fetching the original package tarballs for diffing.

## Usage

### Making patches

First make changes to the files of a particular package in your node_modules folder, then run

```sh
yarn yarn-berry-patch-package package-name
```

where `package-name` matches the name of the package you made changes to.

If this is the first time you've used `yarn-berry-patch-package`, it will create a folder called `patches` in the root dir of your app. Inside will be a file called `package-name+0.44.0.patch` or something, which is a diff between the clean original and your fixed version. Commit this to share the fix with your team.

#### Options

- **`--include <regexp>`** -- Only consider paths matching the regexp when creating patch files. Paths are relative to the root dir of the package to be patched. Default: `.*`

- **`--exclude <regexp>`** -- Ignore paths matching the regexp when creating patch files. Paths are relative to the root dir of the package to be patched. Default: `package\.json$`

- **`--case-sensitive-path-filtering`** -- Make regexps used in --include or --exclude filters case-sensitive.

- **`--patch-dir`** -- Specify the name for the directory in which to put the patch files.

- **`--create-issue`** -- For packages whose source is hosted on GitHub this option opens a web browser with a draft issue based on your diff.

#### Nested packages

If you are trying to patch a package at, e.g. `node_modules/package/node_modules/another-package` you can just put a `/` between the package names:

```sh
yarn yarn-berry-patch-package package/another-package
```

It works with scoped packages too:

```sh
yarn yarn-berry-patch-package @my/package/@my/other-package
```

### Making patches for deeply nested packages (manual patches)

Standard patches work when a package exists at a single known path in `node_modules`. But sometimes the same package appears at many nested locations (e.g. `node_modules/parentA/node_modules/@scope/pkg` and `node_modules/parentB/node_modules/@scope/pkg`). For these cases you can create `.manualpatch` files using the `--create-manualpatch` flag.

#### Creating a manual patch

1. Find a nested instance of the package you want to patch:

    ```sh
    find node_modules -path "*/node_modules/@scope/pkg/package.json" | head -5
    ```

2. Edit the files at that nested location:

    ```sh
    vim node_modules/parentA/node_modules/@scope/pkg/lib/brokenFile.js
    ```

3. Run yarn-berry-patch-package with `--create-manualpatch`, passing the path to the nested package:

    ```sh
    yarn yarn-berry-patch-package --create-manualpatch node_modules/parentA/node_modules/@scope/pkg
    ```

This creates a file like `patches/manually-applied-patches/@scope+pkg+1.2.3.manualpatch`.

It doesn't matter which nested instance you point to -- you just need one at the right version that has your edits. The diff inside uses paths relative to the package's own `node_modules` entry (e.g. `node_modules/@scope/pkg/lib/brokenFile.js`), not the full nested path. This makes the patch portable across all nested locations.

#### Applying manual patches

Manual patches are **not** applied automatically by `yarn-berry-patch-package`. They are designed to work with a separate application script that scans `node_modules` for all matching instances of the package and applies the patch to each one using:

```sh
git apply --ignore-whitespace --whitespace=nowarn --directory <nested-path> <patchfile>
```

The `--directory` flag offsets the diff paths to target each nested location.

The `--include`, `--exclude`, `--case-sensitive-path-filtering`, and `--patch-dir` options all work with `--create-manualpatch`. The output directory is `<patch-dir>/manually-applied-patches/` (created automatically if it doesn't exist).

### Updating patches

Use exactly the same process as for making patches in the first place, i.e. make more changes, run yarn-berry-patch-package, commit the changes to the patch file.

### Applying patches

Run `yarn-berry-patch-package` without arguments to apply all patches in your project.

#### Options

- **`--error-on-fail`** -- Forces yarn-berry-patch-package to exit with code 1 after failing. When running locally yarn-berry-patch-package always exits with 0 by default. `--error-on-fail` is switched on by default on CI.

- **`--error-on-warn`** -- Forces yarn-berry-patch-package to exit with code 1 after warning (e.g. version mismatch warnings).

- **`--reverse`** -- Un-applies all patches. Note that this will fail if the patched files have changed since being patched. In that case, you'll probably need to re-install `node_modules`.

- **`--patch-dir`** -- Specify the name for the directory in which the patch files are located.

- **`--partial`** -- Apply as many changes as possible from a patch file, even if some hunks fail. Errors are written to `./patch-package-errors.log`.

### Dev-only patches

If you deploy your package to production (e.g. your package is a server) then any patched `devDependencies` will not be present when yarn-berry-patch-package runs in production. It will happily ignore those patch files if the package to be patched is listed directly in the `devDependencies` of your package.json. If it's a transitive dependency yarn-berry-patch-package can't detect that it is safe to ignore and will throw an error. To fix this, mark patches for transitive dev dependencies as dev-only by renaming from, e.g.

    package-name+0.44.0.patch

to

    package-name+0.44.0.dev.patch

This will allow those patch files to be safely ignored when `NODE_ENV=production`.

### Creating multiple patches for the same package

If you want to add another patch file to a package, you can use the `--append` flag while supplying a name for the patch.

Make your changes inside `node_modules/react-native` then run e.g.

```sh
yarn yarn-berry-patch-package react-native --append 'fix-touchable-opacity'
```

This will create a new patch file while renaming the old patch file so that you now have:

- `patches/react-native+0.72.0+001+initial.patch`
- `patches/react-native+0.72.0+002+fix-touchable-opacity.patch`

The patches are ordered in a sequence, so that they can build on each other if necessary.

To update a sequenced patch file that isn't the last one, use `--rebase`:

```sh
yarn yarn-berry-patch-package react-native --rebase patches/react-native+0.72.0+001+initial.patch
```

This will un-apply later patches. Make your changes, then run `yarn yarn-berry-patch-package react-native` to finish the rebase.

## How it works

When creating a patch:
1. Reads your Yarn v4+ lockfile to determine the exact package version
2. Uses `npm pack` to download only the package tarball (no transitive dependencies) to a temporary directory
3. Diffs the original against your modified version in `node_modules`
4. Saves the diff as a `.patch` file (or `.manualpatch` file when using `--create-manualpatch`)

When applying patches:
1. Reads patch files from the `patches` directory
2. Applies them to the corresponding packages in `node_modules`

## License

MIT

Based on [patch-package](https://github.com/ds300/patch-package) by David Sheldrick.
