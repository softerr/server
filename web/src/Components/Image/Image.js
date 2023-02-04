import { useState } from "react";
import { useSelector } from "react-redux";
import myFetchImage from "../../hooks/myFetchImage";

const Image = () => {
    const [image, setState] = useState(null);
    const cachedUser = useSelector(state => state.user);

    const handleImageChange = e => {
        setState(e.target.files[0]);
    };

    const handleSubmit = e => {
        e.preventDefault();
        //let reader = new FileReader();
        //reader.readAsDataURL(image);

        // reader.onload = () => {
        //myFetchImage("/api/image", "POST", cachedUser.token, image);
        //};
        // console.log(reader);
        const formData = new FormData();

        // Update the formData object
        formData.append("sendimage", image, image.name);

        console.log(formData);
        myFetchImage("/api/image", "POST", cachedUser.token, formData);
    };
    return (
        <form onSubmit={handleSubmit} method="POST" enctype="multipart/form-data">
            <input type="file" id="image" name="sendimage" accept="image/png, image/jpeg" onChange={handleImageChange}></input>
            <input type="submit" />
        </form>
    );
};

export default Image;
