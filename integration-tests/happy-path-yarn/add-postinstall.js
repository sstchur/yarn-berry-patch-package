require("fs").writeFileSync(
  "./package.json",
  JSON.stringify({
    ...require("./package.json"),
    scripts: {
      postinstall: "yarn-berry-patch-package",
    },
  }),
)