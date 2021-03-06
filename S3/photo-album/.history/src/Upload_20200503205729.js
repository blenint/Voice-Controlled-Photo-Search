import React, { Component } from "react";
import Dropzone from "./Dropzone";
import "./Upload.css";
import Progress from "./Progress";
var apigClientFactory = require('./apigClient').default;
var AWS = require('aws-sdk');

class Upload extends Component {
  constructor(props) {
    super(props);
    this.state = {
      files: [],
      uploading: false,
      uploadProgress: {},
      successfullUploaded: false,
      apigClient: null
    };

    this.onFilesAdded = this.onFilesAdded.bind(this);
    this.uploadFiles = this.uploadFiles.bind(this);
    this.sendRequest = this.sendRequest.bind(this);
    this.renderActions = this.renderActions.bind(this);
  }

  onFilesAdded(files) {
    this.setState(prevState => ({
      files: prevState.files.concat(files)
    }));
  }

  componentDidMount() {
    var apigClient = apigClientFactory.newClient({
      apiKey: 'VG5vT5FSru1Wr2nkfnAsI6qbvya6x48acmdA7jdb'
    });

    this.setState({
      apigClient : apigClient
    });
  }

  async uploadFiles() {
    this.setState({ uploadProgress: {}, uploading: true });
    const promises = [];
    this.state.files.forEach(file => {
      promises.push(this.sendRequest(file));
    });

    try {
      await Promise.all(promises);

      this.setState({ successfullUploaded: true, uploading: false });
    } catch (e) {
      // Not Production ready! Do some error handling here instead...
      this.setState({ successfullUploaded: true, uploading: false });
    }
  }

  sendRequest(file) {
    return new Promise((resolve, reject) => {
      const req = new XMLHttpRequest();

      req.upload.addEventListener("progress", event => {
        if (event.lengthComputable) {
          const copy = { ...this.state.uploadProgress };
          copy[file.name] = {
            state: "pending",
            percentage: (event.loaded / event.total) * 100
          };
          this.setState({ uploadProgress: copy });
        }
      });

      req.upload.addEventListener("load", event => {
        const copy = { ...this.state.uploadProgress };
        copy[file.name] = { state: "done", percentage: 100 };
        this.setState({ uploadProgress: copy });
        resolve(req.response);
      });

      req.upload.addEventListener("error", event => {
        const copy = { ...this.state.uploadProgress };
        copy[file.name] = { state: "error", percentage: 0 };
        this.setState({ uploadProgress: copy });
        reject(req.response);
      });

      const formData = new FormData();
      formData.append("file", file, file.name);

      var bucketName = 'b2-photo-bucket'

      const params = {
        'Content-Type': file.type,
        'bucket': bucketName,
        'key': file.name
      }

      const body = {
        'body': file
      }

      console.log('params: ', params)
      console.log('Body: ', body)
      console.log('apigClient: ', this.state.apigClient)

      // this.state.apigClient.uploadBucketKeyPut(params, body)
      // .then((response) => {
      //   console.log(response)
      // })
      // .catch((result) => {
      //   console.error(result);
      // });
      if (file) {

      var xhr = new XMLHttpRequest();
      xhr.open("PUT", `https://gf1tccyqza.execute-api.us-east-1.amazonaws.com/Dev/upload/?bucket=${bucketName}key=${file.name}`);
      xhr.setRequestHeader("Content-Type", file.type);
console.log("f.name:", file.name)
      console.log("upload succeed!")

      xhr.setRequestHeader("x-api-key", "VG5vT5FSru1Wr2nkfnAsI6qbvya6x48acmdA7jdb");
      xhr.setRequestHeader("Access-Control-Allow-Origin", "http://localhost:3000");
xhr.setRequestHeader('Access-Control-Allow-Headers', 'Content-Type,x-requested-with,Access-Control-Allow-Origin,Access-Control-Allow-Headers,Access-Control-Allow-Methods');
xhr.setRequestHeader("Access-Control-Allow-Methods", 'POST,OPTIONS');
xhr.setRequestHeader("Access-Control-Allow-Credentials", true);
console.log("file to send:", file)
xhr.send(file);
    }
    else{
      alert("No file chosen!");
    }
    });
  }

  renderProgress(file) {
    const uploadProgress = this.state.uploadProgress[file.name];
    if (this.state.uploading || this.state.successfullUploaded) {
      return (
        <div className="ProgressWrapper">
          <Progress progress={uploadProgress ? uploadProgress.percentage : 0} />
          <img
            className="CheckIcon"
            alt="done"
            src="baseline-check_circle_outline-24px.svg"
            style={{
              opacity:
                uploadProgress && uploadProgress.state === "done" ? 0.5 : 0
            }}
          />
        </div>
      );
    }
  }

  renderActions() {
    if (this.state.successfullUploaded) {
      return (
        <button
          onClick={() =>
            this.setState({ files: [], successfullUploaded: false })
          }
        >
          Clear
        </button>
      );
    } else {
      return (
        <button
          disabled={this.state.files.length < 0 || this.state.uploading}
          onClick={this.uploadFiles}
        >
          Upload
        </button>
      );
    }
  }

  render() {
    return (
      <div className="Upload">
        <div className="Content">
          <div>
            <Dropzone
              onFilesAdded={this.onFilesAdded}
              disabled={this.state.uploading || this.state.successfullUploaded}
            />
          </div>
          <div className="Files">
            {this.state.files.map(file => {
              return (
                <div key={file.name} className="Row">
                  <span className="Filename">{file.name}</span>
                  {this.renderProgress(file)}
                </div>
              );
            })}
          </div>
        </div>
        <div className="Actions">{this.renderActions()}</div>
      </div>
    );
  }
}

export default Upload;