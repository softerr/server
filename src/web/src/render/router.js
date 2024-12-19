const pathToRegex = path => new RegExp('^' + path.replace(/\//g, '\\/').replace(/:\w+/g, '(.+)') + '$');

const getParams = route => {
    const result = location.pathname.match(pathToRegex(route.path));
    const values = result.slice(1);
    const keys = Array.from(route.path.matchAll(/:(\w+)/g)).map(result => result[1]);

    return Object.fromEntries(keys.map((key, i) => {
        return [key, values[i]];
    }));
};

const router = (routes) => {
    const route = routes.find(route => location.pathname.match(pathToRegex(route.path)) !== null);
    return new route.view(getParams(route));
}

export default router;
