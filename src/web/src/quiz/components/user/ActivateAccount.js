import { useEffect, useState } from "react";
import { Container, Spinner } from "react-bootstrap";
import { useNavigate, useParams } from "react-router-dom";
import NotFound from "../../layouts/NotFound";
import { userActivate } from "../../../user/services";

const ActivateAccount = () => {
    const { token } = useParams();
    const navigate = useNavigate();
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        userActivate(token,
            () => navigate("/quiz/login", { replace: true, state: { message: "Account was successfully activated." } }),
            res => {
                setFailed(true);
                console.log(res);
            }
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return failed ? (
        <NotFound />
    ) : (
        <Container fluid="sm" className="d-flex justify-content-center" style={{ marginTop: "100px" }}>
            <Spinner animation="border" variant="primary" />
        </Container>
    );
};

export default ActivateAccount;
