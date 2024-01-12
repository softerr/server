import axios from "axios";

const apiFetch = (url, method, token, body, onSuccess, onError) => {
    const source = axios.CancelToken.source();

    axios({
        method,
        url,
        headers: {
            Authorization: token ? `Bearer ${token}` : "",
            Accept: "application/json",
            "Content-Type": "application/json",
        },
        data: body,
        cancelToken: source.token,
    })
        .then(res => {
            if (res.status === 204) {
                onSuccess(undefined);
            } else {
                onSuccess(res.data);
            }
        })
        .catch(error => {
            if (axios.isCancel(error)) {
                console.log("Request canceled:", error.message);
            } else {
                onError(error.response ? error.response.data : error.message);
            }
        });

    return () => source.cancel("Request canceled by cleanup");
};

export default apiFetch;
