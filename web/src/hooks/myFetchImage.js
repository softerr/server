const myFetchImage = (url, method, token, body, onSuccess, onError) => {
    const abortCont = new AbortController();
    fetch(url, {
        method,
        headers: {
            Authorization: token ? "Bearer " + token : "",
            Accept: "application/json",
        },
        body: body,
        signal: abortCont.signal,
    }).then(async res => {
        if (res.ok) {
            if (res.status === 204) {
                onSuccess(undefined);
            } else {
                onSuccess(await res.json());
            }
        } else {
            onError(await res.json());
        }
    });
    return () => abortCont.abort();
};

export default myFetchImage;
