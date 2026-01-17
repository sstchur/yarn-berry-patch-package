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

Patches created by `yarn-berry-patch-package` are automatically and gracefully applied when you run `yarn install`.

No more waiting around for pull requests to be merged and published. No more forking repos just to fix that one tiny thing preventing your app from working.

## Requirements

- **Yarn v4+** with `nodeLinker: node-modules` in `.yarnrc.yml`
- Node.js >= 14
- npm (used internally for fetching original package files)

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

If your packages come from a private registry, make sure you have an `.npmrc` file in your project root with the appropriate registry configuration and authentication. This file is used when fetching the original package files for diffing.

### Yarn workspaces

Same as above. Note that if you want to patch un-hoisted packages you'll need to repeat the setup process for the child package. Also make sure you're in the child package directory when you run `yarn-berry-patch-package` to generate the patch files.

### Docker and CI

- In your `Dockerfile`, remember to copy over the patch files _before_ running `yarn install`
- If you cache `node_modules` rather than running `yarn install` every time, make sure that the `patches` dir is included in your cache key somehow. Otherwise if you update a patch then the change may not be reflected on subsequent CI runs.

### CircleCI

Create a hash of your patches before loading/saving your cache. Run `md5sum patches/* > patches.hash` (or `md5 patches/* > patches.hash` on macOS).

```yaml
- run:
    name: patch hash
    command: md5sum patches/* > patches.hash
```

Then, update your hash key to include a checksum of that file:

```yaml
- restore_cache:
    key:
      app-node_modules-v1-{{ checksum "yarn.lock" }}-{{ checksum "patches.hash" }}
```

## Usage

### Making patches

First make changes to the files of a particular package in your node_modules folder, then run

    yarn yarn-berry-patch-package package-name

where `package-name` matches the name of the package you made changes to.

If this is the first time you've used `yarn-berry-patch-package`, it will create a folder called `patches` in the root dir of your app. Inside will be a file called `package-name+0.44.0.patch` or something, which is a diff between normal old `package-name` and your fixed version. Commit this to share the fix with your team.

> **Note:** Patch creation may take some time for packages with many dependencies, especially when fetching from private registries.

#### Options

- `--create-issue`

  For packages whose source is hosted on GitHub this option opens a web browser with a draft issue based on your diff.

- `--exclude <regexp>`

  Ignore paths matching the regexp when creating patch files. Paths are relative to the root dir of the package to be patched.

  Default value: `package\\.json$`

- `--include <regexp>`

  Only consider paths matching the regexp when creating patch files. Paths are relative to the root dir of the package to be patched.

  Default value: `.*`

- `--case-sensitive-path-filtering`

  Make regexps used in --include or --exclude filters case-sensitive.

- `--patch-dir`

  Specify the name for the directory in which to put the patch files.

#### Nested packages

If you are trying to patch a package at, e.g. `node_modules/package/node_modules/another-package` you can just put a `/` between the package names:

    yarn yarn-berry-patch-package package/another-package

It works with scoped packages too

    yarn yarn-berry-patch-package @my/package/@my/other-package

### Updating patches

Use exactly the same process as for making patches in the first place, i.e. make more changes, run yarn-berry-patch-package, commit the changes to the patch file.

### Applying patches

Run `yarn-berry-patch-package` without arguments to apply all patches in your project.

#### Options

- `--error-on-fail`

  Forces yarn-berry-patch-package to exit with code 1 after failing.

  When running locally yarn-berry-patch-package always exits with 0 by default. This happens even after failing to apply patches because otherwise yarn.lock and package.json might get out of sync with node_modules, which can be very confusing.

  `--error-on-fail` is **switched on** by default on CI.

- `--error-on-warn`

  Forces yarn-berry-patch-package to exit with code 1 after warning.

- `--reverse`

  Un-applies all patches.

  Note that this will fail if the patched files have changed since being patched. In that case, you'll probably need to re-install `node_modules`.

- `--patch-dir`

  Specify the name for the directory in which the patch files are located

#### Notes

To apply patches individually, you may use `git`:

    git apply --ignore-whitespace patches/package-name+0.44.2.patch

or `patch` in unixy environments:

    patch -p1 -i patches/package-name+0.44.2.patch

### Dev-only patches

If you deploy your package to production (e.g. your package is a server) then any patched `devDependencies` will not be present when yarn-berry-patch-package runs in production. It will happily ignore those patch files if the package to be patched is listed directly in the `devDependencies` of your package.json. If it's a transitive dependency yarn-berry-patch-package can't detect that it is safe to ignore and will throw an error. To fix this, mark patches for transitive dev dependencies as dev-only by renaming from, e.g.

    package-name+0.44.0.patch

to

    package-name+0.44.0.dev.patch

This will allow those patch files to be safely ignored when `NODE_ENV=production`.

### Creating multiple patches for the same package

_This is an advanced feature._

Let's say you have a patch for react-native called

- `patches/react-native+0.72.0.patch`

If you want to add another patch file to `react-native`, you can use the `--append` flag while supplying a name for the patch.

Just make your changes inside `node_modules/react-native` then run e.g.

    yarn yarn-berry-patch-package react-native --append 'fix-touchable-opacity'

This will create a new patch file while renaming the old patch file so that you now have:

- `patches/react-native+0.72.0+001+initial.patch`
- `patches/react-native+0.72.0+002+fix-touchable-opacity.patch`

The patches are ordered in a sequence, so that they can build on each other if necessary. **Think of these as commits in a git history**.

#### Updating a sequenced patch file

If the patch file is the last one in the sequence, you can just make your changes inside e.g. `node_modules/react-native` and then run

    yarn yarn-berry-patch-package react-native

This will update the last patch file in the sequence.

If the patch file is not the last one in the sequence **you need to use the `--rebase` feature** to un-apply the succeeding patch files first.

Using the example above, let's say you want to update the `001+initial` patch but leave the other patch alone. You can run

    yarn yarn-berry-patch-package react-native --rebase patches/react-native+0.72.0+001+initial.patch

This will undo the `002-fix-touchable-opacity` patch file. You can then make your changes and run

    yarn yarn-berry-patch-package react-native

to finish the rebase by updating the `001+initial` patch file and re-apply the `002-fix-touchable-opacity` patch file, leaving you with all patches applied and up-to-date.

#### Inserting a new patch file in the middle of an existing sequence

Using the above example, let's say you want to insert a new patch file between the `001+initial` and `002+fix-touchable-opacity` patch files. You can run

    yarn yarn-berry-patch-package react-native --rebase patches/react-native+0.72.0+001+initial.patch

This will undo the `002-fix-touchable-opacity` patch file. You can then make any changes you want to insert in a new patch file and run

    yarn yarn-berry-patch-package react-native --append 'fix-console-warnings'

This will create a new patch file while renaming any successive patches to maintain the sequence order, leaving you with

- `patches/react-native+0.72.0+001+initial.patch`
- `patches/react-native+0.72.0+002+fix-console-warnings.patch`
- `patches/react-native+0.72.0+003+fix-touchable-opacity.patch`

To insert a new patch file at the start of the sequence, you can run

    yarn yarn-berry-patch-package react-native --rebase 0

Which will un-apply all patch files in the sequence. Then follow the process above to create a new patch file numbered `001`.

#### Deleting a sequenced patch file

To delete a sequenced patch file, just delete it, then remove and reinstall your `node_modules` folder.

If you deleted one of the patch files other than the last one, you don't need to update the sequence numbers in the successive patch file names, but you might want to do so to keep things tidy.

#### Partially applying a broken patch file

Normally patch application is atomic per patch file. i.e. if a patch file contains an error anywhere then none of the changes in the patch file will be applied and saved to disk.

This can be problematic if you have a patch with many changes and you want to keep some of them and update others.

In this case you can use the `--partial` option. yarn-berry-patch-package will apply as many of the changes as it can and then leave it to you to fix the rest.

Any errors encountered will be written to a file `./patch-package-errors.log` to help you keep track of what needs fixing.

## How it works

When creating a patch:
1. Reads your Yarn v4+ lockfile to determine the exact package version
2. Uses npm to fetch a clean copy of the original package to a temporary directory
3. Diffs the original against your modified version in `node_modules`
4. Saves the diff as a patch file

When applying patches:
1. Reads patch files from the `patches` directory
2. Applies them to the corresponding packages in `node_modules`

## Benefits of patching over forking

- Sometimes forks need extra build steps, e.g. with react-native for Android. Forget that noise.
- Get told in big red letters when the dependency changed and you need to check that your fix is still valid.
- Keep your patches colocated with the code that depends on them.
- Patches can be reviewed as part of your normal review process, forks probably can't

## When to fork instead

- The change is too consequential to be developed in situ.
- The change would be useful to other people as-is.
- You can afford to make a proper PR to upstream.

## License

MIT

Based on [patch-package](https://github.com/ds300/patch-package) by David Sheldrick.
