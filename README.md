# react-declassify: say goodbye to class components \[EXPERIMENTAL\]

## Usage

```
yarn add -D @codemod/cli react-declassify
# OR
npm install -D @codemod/cli react-declassify
```

then

```
npx codemod --plugin react-declassify 'src/**/*.tsx'
```

## Progress

- [x] Convert render function (basic feature)
- [ ] Superclass detection
  - [x] Support `React.Component`
  - [ ] Support `React.PureComponent`
- [ ] Class node type
  - [x] Support class declarations
  - [ ] Support `export default class` declarations
  - [ ] Support class expressions
- [ ] TypeScript support
  - [x] Add `React.FC` annotation
  - [ ] Transform `P` type argument
  - [ ] Transform `S` type argument
  - [ ] Transform generic components
- [ ] Support for `this.props`
  - [x] Convert `this.props` to `props` parameter
  - [ ] Rename `props` if necessary
  - [x] Hoist expansion of `this.props`
  - [x] Rename prop variables if necessary
  - [ ] transform `defaultProps`
- [ ] Support for user-defined methods
  - [x] Transform methods to `function`s
  - [ ] Transform class fields initialized as functions to `function`s
  - [ ] Use `useCallback` if deemed necessary
  - [ ] Auto-expand direct callback call (like `this.props.onClick()`) to indirect call
  - [ ] Rename methods if necessary
  - [ ] Skip method-binding expressions (e.g. `onClick={this.onClick.bind(this)}`)
  - [ ] Skip method-binding statements (e.g. `this.onClick = this.onClick.bind(this)`)
- [ ] Support for `this.state`
  - [ ] Decompose `this.state` into `useState` variables
  - [ ] Rename states if necessary
  - [ ] Support functional updates
  - [ ] Support lazy initialization
- [ ] Support for refs
  - [ ] Transform `createRef` to `useRef`
  - [ ] Transform member assignment to `useRef`
  - [ ] Transform legacy string refs as far as possible
- [ ] Support for lifecycles
  - [ ] Transform componentDidMount, componentDidUpdate, and componentWillUnmount
  - [ ]
- [ ] Support for receiving refs
  - [ ] Use `forwardRef` + `useImperativeHandle` when requested by the user
- [ ] Support for contexts
  - [ ] Transform `contextType` to `useContext`
  - [ ] Transform the second parameter for the legacy `contextTypes`
- [ ] Transform `static propTypes` to assignments
- [x] Rename local variables in `render` if necessary
