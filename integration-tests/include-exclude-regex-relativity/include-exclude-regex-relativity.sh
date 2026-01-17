# make sure errors stop the script
set -e

echo "add yarn-berry-patch-package"
yarn add $1
alias patch-package=./node_modules/.bin/yarn-berry-patch-package

echo "mutate words.js"
npx replace words patch-packages node_modules/lodash/words.js

echo "yarn-berry-patch-package includes words.js in a patch by default"
patch-package lodash

echo "yarn-berry-patch-package doesn't include words.js if excluded with relative path"
if patch-package lodash --exclude '^words' ; then
  exit 1
fi

echo "yarn-berry-patch-package includes words.js if included with relative path"
patch-package lodash --include '^words'

echo "yarn-berry-patch-package doesn't exclude words.js if excluded with node_modules path"
patch-package lodash --exclude node_modules/lodash/words.js

echo "yarn-berry-patch-package doesn't include words.js if included with node_modules path"
if patch-package lodash --include node_modules/lodash/words.js ; then
  exit 1
fi

echo "yarn-berry-patch-package doesn't exclude words.js if excluded with lodash path"
patch-package lodash --exclude lodash/words.js

echo "yarn-berry-patch-package doesn't include words.js if included with lodash path"
if patch-package lodash --include lodash/words.js ; then
  exit 1
fi

echo "yarn-berry-patch-package does exclude words.js if excluded without prefix"
if patch-package lodash --exclude words.js ; then
  exit 1
fi
