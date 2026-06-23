default:
    just -l

# Build the project
build:
    yarn install
    yarn build

# Install the packaged tarball globally on your machine
# Example of how to use afterwords:
# yarn dlx @codemod/cli --plugin react-declassify
install-global: pack
    npm install -g ./package.tgz

# Run tests
test: build
    yarn test

# Create a yarn tarball (equivalent to a Python wheel)
pack: build
    yarn pack --filename package.tgz

# Run the codemod locally using the built plugin against a target directory
# Usage: just run-local ../my-project/src
run-local target_dir: build
    yarn dlx @codemod/cli --plugin ./dist/index.js '{{ target_dir }}/**/*.tsx' '{{ target_dir }}/**/*.ts' '{{ target_dir }}/**/*.jsx' '{{ target_dir }}/**/*.js'

# Run the Codemod AI Workflow WITHOUT the AI step
# Usage: just run-workflow ../my-project/src
run-workflow target_dir: build
    yarn dlx codemod@latest run . --target {{ target_dir }}

# Run the Codemod AI Workflow WITH the AI step turned on
# Usage: just run-workflow-ai ../my-project/src
run-workflow-ai target_dir: build
    yarn dlx codemod@latest run . --target {{ target_dir }} --autoAiReview=true
