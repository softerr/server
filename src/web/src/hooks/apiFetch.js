const apiFetch = (url, method, token, body, onSuccess, onError) => {
    const abortCont = new AbortController();
    fetch(url, {
        method,
        headers: {
            Authorization: token ? "Bearer " + token : "",
            Accept: "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: abortCont.signal,
    }).then(async res => {
        if (res.ok) {
            onSuccess(res.status === 204 ? undefined : await res.json());
        } else {
            onError(await res.json());
        }
    });
    return () => abortCont.abort();
};

export default apiFetch;
