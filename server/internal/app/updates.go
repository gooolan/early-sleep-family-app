package app

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
)

type updateFileHandler struct {
	directory string
}

func newUpdateFileHandler(directory string) http.Handler {
	return &updateFileHandler{directory: directory}
}

func (handler *updateFileHandler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	relativePath := strings.TrimPrefix(request.URL.Path, "/updates/")
	if !validUpdatePath(relativePath) {
		http.NotFound(writer, request)
		return
	}

	root, err := os.OpenRoot(handler.directory)
	if err != nil {
		http.NotFound(writer, request)
		return
	}
	defer root.Close()

	file, err := root.Open(relativePath)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) || errors.Is(err, fs.ErrPermission) {
			http.NotFound(writer, request)
			return
		}
		http.Error(writer, "读取更新资源失败", http.StatusInternalServerError)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		http.Error(writer, "读取更新资源失败", http.StatusInternalServerError)
		return
	}
	if !info.Mode().IsRegular() {
		http.NotFound(writer, request)
		return
	}

	setUpdateHeaders(writer, relativePath)
	http.ServeContent(writer, request, info.Name(), info.ModTime(), file)
}

func validUpdatePath(relativePath string) bool {
	if relativePath == "" || !fs.ValidPath(relativePath) {
		return false
	}
	for _, segment := range strings.Split(relativePath, "/") {
		if strings.HasPrefix(segment, ".") {
			return false
		}
	}

	switch strings.ToLower(path.Ext(relativePath)) {
	case ".apk", ".json", ".sha256", ".sig", ".zip":
		return true
	default:
		return false
	}
}

func setUpdateHeaders(writer http.ResponseWriter, relativePath string) {
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	if relativePath == "manifest.json" {
		writer.Header().Set("Cache-Control", "no-store")
		writer.Header().Set("Pragma", "no-cache")
	} else {
		writer.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}

	switch strings.ToLower(path.Ext(relativePath)) {
	case ".apk":
		writer.Header().Set("Content-Type", "application/vnd.android.package-archive")
		writer.Header().Set("Content-Disposition", `attachment; filename="`+path.Base(relativePath)+`"`)
	case ".json":
		writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	case ".sha256":
		writer.Header().Set("Content-Type", "text/plain; charset=utf-8")
	case ".sig":
		writer.Header().Set("Content-Type", "application/octet-stream")
	case ".zip":
		writer.Header().Set("Content-Type", "application/zip")
	}
}
