# make sure errors stop the script
set -e

echo "add yarn-berry-patch-package"
yarn add $1
alias patch-package=./node_modules/.bin/yarn-berry-patch-package

echo "SNAPSHOT: patch parse failure message"
if patch-package; then
  exit 1
fi
echo "END SNAPSHOT"
