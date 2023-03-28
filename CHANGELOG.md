## Unreleased

- Added
  - Support for method-binding patterns e.g. `this.foo = this.foo.bind(this);`

## 0.1.8

- Added
  - Implement MVP for componentDidMount/componentDidUpdate/componentWillUnmount
- Fixed
  - Don't fail if user-defined class field (e.g. `this.foo`) is assigned without initializing.

## 0.1.7

- Added
  - Add support for `useCallback`
- Fixed
  - Use function declaration instead of function expression when possible

## 0.1.6

- Added
  - Add support for more type annotations on methods
  - Add support for modifying types reflecting `defaultProps`
  - Add support for `React.PureComponent`
  - Add support for generics

## 0.1.5

- Added
  - Add support for refs (types are supported as well)
  - Add support for state types
  - Add support for opt-out in one of:
    - `@abstract` JSDoc comment
    - `abstract` modifier
    - `react-declassify-disable` comment
- Fixed
  - Keep generator/async flags
  - Fix renaming failure in some cases
  - Fix local variable conflict when the name was introduced in an inner block.
  - Fix `this.props`, `this.setState`, and so on not being accounted for when they are declared in the constructor.

## 0.1.4

- Added
  - Add support for `const { ... } = this.state`
  - Rename methods if necessary
- Misc
  - Refactoring

## 0.1.3

- Added
  - Add support for `this.state` initialization in constructor
  - Add support for `defaultProps`
- Misc
  - Heavily refactored internal analysis

## 0.1.2

- Added
  - Add support for `export default class` declarations
  - Add support for class fields initialized as functions
- Fixed
  - Fix emission of hoisted props

## 0.1.1

- Added
  - Transform `P` type argument
  - Transform `setState` (simple case)

## 0.1.0

Initial experimental release.
