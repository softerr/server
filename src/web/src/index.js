import './index.css'
import render from './render';

render();

if (module.hot) {
    module.hot.accept('./render', () => {
        console.log('hot: render');
        require('./render').default();
    })
}