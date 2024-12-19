import './index.css'
import render from './render/render.js';

const display = async (render) => {
    document.body.innerHTML = await render();
};

const navigateTo = url => {
    history.pushState({}, '', url);
    display(render);
};

window.addEventListener('popstate', () => display(render));

document.addEventListener('DOMContentLoaded', () => {
    document.body.addEventListener('click', e => {
        if (e.target.matches('[data-link]')) {
            e.preventDefault();
            navigateTo(e.target.href);
        }
    })
    display(render);
});

if (module.hot) {
    module.hot.accept('./render/render.js', () => {
        display(require('./render/render.js').default);
    });
}
