import Post from "./views/Post.js";
import Posts from "./views/Posts.js";
import Root from "./views/Root.js";
import './index.css'

const pathToRegex = path => new RegExp('^' + path.replace(/\//g, '\\/').replace(/:\w+/g, '(.+)') + '$');

const getParams = route => {
    const result = location.pathname.match(pathToRegex(route.path));
    const values = result.slice(1);
    const keys = Array.from(route.path.matchAll(/:(\w+)/g)).map(result => result[1]);

    return Object.fromEntries(keys.map((key, i) => {
        return [key, values[i]];
    }));
};

const navigateTo = url => {
    history.pushState({}, '', url);
    router();
};

const router = async () => {
    console.log('router');
    const routes = [
        { path: '/', view: Root },
        { path: '/post', view: Posts },
        { path: '/post/:id', view: Post },
    ];

    console.log('path', location.pathname);
    const route = routes.find(route => location.pathname.match(pathToRegex(route.path)) !== null);

    const view = new route.view(getParams(route));

    document.body.innerHTML = await view.getHtml();
}

window.addEventListener('popstate', router);

document.addEventListener('DOMContentLoaded', () => {
    document.body.addEventListener('click', e => {
        if (e.target.matches('[data-link]')) {
            e.preventDefault();
            navigateTo(e.target.href);
        }
    })
    router();
});

if (module.hot) {
    const context = require.context('./views', true, /\.js$/);
    console.log('files:');
    context.keys().forEach((file) => {
        const p = context.resolve(file);
        console.log(p);
        module.hot.accept(p, function () {
            context = require.context('./views', true, /\.js$/);
            router();
        });
        
    });
    /*module.hot.accept('./views/Posts.js', function () {
        router();
    });*/
}