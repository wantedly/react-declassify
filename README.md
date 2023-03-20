# react-declassify: say goodbye to class components

This codemod automatically transforms **React class components** into **React functional components using Hooks** for you!

|Before|After|
|---|---|
|![before example 1](./img/example1-before.png)|![after example 1](./img/example1-after.png)|

## Features

- ✅ Supports props, states, methods, and refs.
- ✅ Comments, spaces, and styles are preserved thanks to the [recast](https://github.com/benjamn/recast) library.
- ✅ Designed to generate as idiomatic code as possible. Not something Babel or Webpack would generate!
- ✅ Based on classical heuristic automation; no need to be fearful about whimsy LLMs.

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

## Example

Before:

```tsx
import React from "react";

type Props = {
  by: number;
};

type State = {
  counter: number;
};

export class C extends React.Component<Props, State> {
  static defaultProps = {
    by: 1
  };

  constructor(props) {
    super(props);
    this.state = {
      counter: 0
    };
  }

  render() {
    return (
      <>
        <button onClick={() => this.onClick()}>
          {this.state.counter}
        </button>
        <p>Current step: {this.props.by}</p>
      </>
    );
  }

  onClick() {
    this.setState({ counter: this.state.counter + this.props.by });
  }
}
```

After:

```tsx
import React from "react";

type Props = {
  by: number;
};

type State = {
  counter: number;
};

export const C: React.FC<Props> = props => {
  const {
    by = 1
  } = props;

  const [counter, setCounter] = React.useState<number>(0);

  function onClick() {
    setCounter(counter + by);
  }

  return <>
    <button onClick={() => onClick()}>
      {counter}
    </button>
    <p>Current step: {by}</p>
  </>;
};
```

Before:

```jsx
import React from "react";

export class C extends React.Component {
  render() {
    const { text, color } = this.props;
    return <button style={{ color }} onClick={() => this.onClick()}>{text}</button>;
  }

  onClick() {
    const { text, handleClick } = this.props;
    alert(`${text} was clicked!`);
    handleClick();
  }
}
```

After:

```jsx
import React from "react";

export const C = props => {
  const {
    text,
    color,
    handleClick
  } = props;

  function onClick() {
    alert(`${text} was clicked!`);
    handleClick();
  }

  return <button style={{ color }} onClick={() => onClick()}>{text}</button>;
};
```

## Progress

- [x] Convert render function (basic feature)
- [ ] Superclass detection
  - [x] Support `React.Component`
  - [ ] Support `React.PureComponent`
- [ ] Class node type
  - [x] Support class declarations
  - [x] Support `export default class` declarations
  - [ ] Support class expressions
- [ ] TypeScript support
  - [x] Add `React.FC` annotation
  - [x] Transform `P` type argument
  - [x] Transform `S` type argument
  - [x] Transform ref types
  - [ ] Transform generic components
  - [ ] Modify Props appropriately if defaultProps is present
  - [ ] Modify Props appropriately if `children` seems to be used
- [ ] Support for `this.props`
  - [x] Convert `this.props` to `props` parameter
  - [ ] Rename `props` if necessary
  - [x] Hoist expansion of `this.props`
  - [x] Rename prop variables if necessary
  - [x] transform `defaultProps`
- [ ] Support for user-defined methods
  - [x] Transform methods to `function`s
  - [x] Transform class fields initialized as functions to `function`s
  - [ ] Use `useCallback` if deemed necessary
  - [ ] Auto-expand direct callback call (like `this.props.onClick()`) to indirect call
  - [x] Rename methods if necessary
  - [ ] Skip method-binding expressions (e.g. `onClick={this.onClick.bind(this)}`)
  - [ ] Skip method-binding statements (e.g. `this.onClick = this.onClick.bind(this)`)
- [ ] Support for `this.state`
  - [x] Decompose `this.state` into `useState` variables
  - [x] Rename states if necessary
  - [ ] Support updating multiple states at once
  - [ ] Support functional updates
  - [ ] Support lazy initialization
- [ ] Support for refs
  - [x] Transform `createRef` to `useRef`
  - [x] Transform member assignment to `useRef`
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
