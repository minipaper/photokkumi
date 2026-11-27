# 얼굴 자동 가리기에 쓰는 구성 요소

포토꾸미의 `얼굴 자동 가리기`는 아래 구성 요소로 사진 속 얼굴을 **PC 안에서만** 찾습니다. 사진은 외부로 보내지 않습니다.

- **YuNet 얼굴 인식 모델** (`yunet/yunet.onnx`, `face_detection_yunet_2026may.onnx`, SHA-256 `ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0`)
  - 출처: OpenCV Zoo https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet
  - 라이선스: MIT, Copyright (c) 2020 Shiqi Yu — 원문 `yunet/LICENSE`
  - 학습: https://github.com/ShiqiYu/libfacedetection.train (WIDER FACE 데이터셋, http://shuoyang1213.me/WIDERFACE/ — 데이터셋 자체는 비상업 연구 조건으로 배포됩니다. 포토꾸미는 비상업 무료 앱으로, 모델 가중치만 MIT 조건으로 포함하며 데이터셋은 포함하지 않습니다.)
- **ONNX Runtime Web** (`onnxruntime-web`, WebAssembly 런타임)
  - 출처: https://github.com/microsoft/onnxruntime
  - 라이선스: MIT, Copyright (c) Microsoft Corporation — 원문 `onnxruntime-web-LICENSE`
