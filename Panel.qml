import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Model.js" as Model

// Shortcut Coach: counts which Hyprland shortcuts you actually press and
// suggests popular ones that aren't a habit yet.
//
// Data comes from hypr/tracker.lua (loaded by ~/.config/hypr/hyprland.lua),
// which writes ~/.local/state/omarchy/shortcut-coach/{catalog,presses}.tsv.
// Everything read from those files is treated as untrusted plain text.
Panel {
  id: root
  moduleName: "tyku8.shortcut-coach"
  ipcTarget: "tyku8.shortcut-coach"

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  // The bar sizes the slot from these; without them the icon gets no room.
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  readonly property string stateDir: Quickshell.env("HOME") + "/.local/state/omarchy/shortcut-coach"
  readonly property color fg: bar ? bar.foreground : Commons.Color.foreground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  // 7, 30, or 0 for all time; Left/Right in the panel steps through them.
  readonly property var ranges: [7, 30, 0]
  property int rangeIndex: 1
  readonly property int rangeDays: ranges[rangeIndex]
  property int recPage: 0
  property real nowEpoch: Date.now() / 1000

  property string catalogText: ""
  property string pressesText: ""

  // Parsed only while the panel is open, so the closed widget costs nothing.
  readonly property var summary: root.opened
    ? Model.summarize(Model.parseCatalog(catalogText), Model.parsePresses(pressesText, Model.sinceFor(rangeDays, nowEpoch)))
    : ({ families: [], total: 0 })
  readonly property var topList: Model.topUsed(summary, 8)
  readonly property var allRecs: Model.recommendations(summary)
  readonly property var recList: Model.page(allRecs, recPage, 5)
  readonly property int coveragePercent: Math.round(Model.coverage(summary) * 100)
  readonly property int topMax: topList.length > 0 ? topList[0].count : 1
  readonly property bool tracking: catalogText.indexOf("\nbind\t") >= 0

  function refresh() {
    root.nowEpoch = Date.now() / 1000
    catalogFile.reload()
    pressesFile.reload()
  }

  function stepRange(delta) {
    root.rangeIndex = (root.rangeIndex + delta + root.ranges.length) % root.ranges.length
    root.recPage = 0
  }

  function rangeLabel(days) {
    if (days === 7) return strings.t("range.week")
    if (days === 30) return strings.t("range.month")
    return strings.t("range.all")
  }

  function recReason(rec) {
    if (rec.count > 0) return strings.tn("rec.used", rec.count).arg(Commons.I18n.formatNumber(rec.count))
    return rec.popular ? strings.t("rec.popularUnused") : strings.t("rec.unused")
  }

  onOpenedChanged: if (opened) refresh()

  FileView {
    id: catalogFile
    path: root.stateDir + "/catalog.tsv"
    printErrors: false
    onLoaded: root.catalogText = text()
    onLoadFailed: root.catalogText = ""
  }

  FileView {
    id: pressesFile
    path: root.stateDir + "/presses.tsv"
    printErrors: false
    onLoaded: root.pressesText = text()
    onLoadFailed: root.pressesText = ""
  }

  // Live while open, so a shortcut pressed with the panel up shows at once.
  Timer { interval: 3000; running: root.opened; repeat: true; onTriggered: root.refresh() }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "󰌌"
    slotSize: Style.bar.statusSlot
    tooltipText: ""
    onPressed: function(b) { root.toggle() }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    centerOnBar: false
    focusTarget: panel.loadedContent
    contentWidth: panel.fittedContentWidth(Style.space(420))
    contentHeight: panel.fittedContentHeight(panel.loadedContentHeight)

    content: PanelKeyCatcher {
      anchors.fill: parent
      implicitHeight: column.implicitHeight
      onMoveRequested: function(dx, dy) { if (dx !== 0) root.stepRange(dx) }
      onActivateRequested: root.recPage++
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(14)

        // ---------- Hero ----------
        Item {
          width: parent.width
          implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight, heroNumber.implicitHeight)

          PlainText {
            id: heroIcon
            text: "󰌌"
            font.pixelSize: Style.font.display
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
          }

          Column {
            id: heroLabels
            anchors.left: heroIcon.right
            anchors.leftMargin: Style.space(14)
            anchors.right: heroNumber.left
            anchors.rightMargin: Style.space(10)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            PlainText {
              width: parent.width
              text: strings.t("title")
              font.pixelSize: Style.font.title
              font.bold: true
              elide: Text.ElideRight
            }

            PlainText {
              width: parent.width
              text: strings.tn("hero.presses", root.summary.total).arg(Commons.I18n.formatNumber(root.summary.total)).toUpperCase()
              opacity: 0.7
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 1.2
              elide: Text.ElideRight
            }
          }

          Column {
            id: heroNumber
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter

            PlainText {
              anchors.right: parent.right
              text: Commons.I18n.formatNumber(root.coveragePercent) + "%"
              font.pixelSize: Style.font.displayLarge
              font.bold: true
            }
            PlainText {
              anchors.right: parent.right
              text: strings.t("hero.coverage")
              opacity: 0.6
              font.pixelSize: Style.font.caption
            }
          }
        }

        // ---------- Range picker ----------
        Row {
          id: rangeRow
          width: parent.width
          spacing: Style.space(6)
          readonly property real cellWidth: (width - spacing * (root.ranges.length - 1)) / root.ranges.length

          Repeater {
            model: root.ranges
            Button {
              required property var modelData
              required property int index
              width: rangeRow.cellWidth
              text: root.rangeLabel(modelData)
              fontSize: Style.font.bodySmall
              foreground: root.fg
              fontFamily: root.fontFamily
              bordered: true
              active: root.rangeIndex === index
              onClicked: { root.rangeIndex = index; root.recPage = 0 }
            }
          }
        }

        PlainText {
          visible: !root.tracking
          width: parent.width
          text: strings.t("empty.tracking")
          wrapMode: Text.WordWrap
          opacity: 0.8
          font.pixelSize: Style.font.bodySmall
        }

        // ---------- Most used ----------
        PanelSeparator { foreground: root.fg; visible: root.tracking }

        Column {
          visible: root.tracking
          width: parent.width
          spacing: Style.space(8)

          PanelSectionHeader {
            text: strings.t("section.top")
            foreground: root.fg
            fontFamily: root.fontFamily
          }

          PlainText {
            visible: root.topList.length === 0
            width: parent.width
            text: strings.t("empty.presses")
            wrapMode: Text.WordWrap
            opacity: 0.6
            font.pixelSize: Style.font.bodySmall
          }

          Repeater {
            model: root.topList
            Column {
              required property var modelData
              width: parent.width
              spacing: Style.space(4)

              Item {
                width: parent.width
                implicitHeight: Math.max(topKeys.implicitHeight, topLabel.implicitHeight)

                KeyChip { id: topKeys; text: modelData.keys; anchors.left: parent.left; anchors.verticalCenter: parent.verticalCenter }
                PlainText {
                  id: topLabel
                  anchors.left: topKeys.right
                  anchors.leftMargin: Style.space(8)
                  anchors.right: topCount.left
                  anchors.rightMargin: Style.space(8)
                  anchors.verticalCenter: parent.verticalCenter
                  text: modelData.label
                  elide: Text.ElideRight
                  font.pixelSize: Style.font.bodySmall
                }
                PlainText {
                  id: topCount
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  text: strings.tn("times", modelData.count).arg(Commons.I18n.formatNumber(modelData.count))
                  font.pixelSize: Style.font.bodySmall
                  font.bold: true
                }
              }

              Rectangle {
                width: parent.width
                height: Style.space(3)
                radius: height / 2
                color: Qt.rgba(root.fg.r, root.fg.g, root.fg.b, 0.10)

                Rectangle {
                  height: parent.height
                  radius: parent.radius
                  color: Commons.Color.accent
                  width: Math.max(parent.height, parent.width * modelData.count / root.topMax)
                  Behavior on width { NumberAnimation { duration: Style.duration(180); easing.type: Easing.OutCubic } }
                }
              }
            }
          }
        }

        // ---------- Recommendations ----------
        PanelSeparator { foreground: root.fg; visible: root.tracking }

        Column {
          visible: root.tracking
          width: parent.width
          spacing: Style.space(10)

          Item {
            width: parent.width
            implicitHeight: Math.max(recHeader.implicitHeight, moreButton.implicitHeight)

            PanelSectionHeader {
              id: recHeader
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              text: strings.t("section.recs")
              foreground: root.fg
              fontFamily: root.fontFamily
            }

            Button {
              id: moreButton
              visible: root.allRecs.length > root.recList.length
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              text: strings.t("recs.more")
              iconText: "󰑐"
              fontSize: Style.font.caption
              foreground: root.fg
              fontFamily: root.fontFamily
              onClicked: root.recPage++
            }
          }

          PlainText {
            visible: root.recList.length === 0
            width: parent.width
            text: strings.t("empty.recs")
            wrapMode: Text.WordWrap
            opacity: 0.6
            font.pixelSize: Style.font.bodySmall
          }

          Repeater {
            model: root.recList
            Item {
              required property var modelData
              width: parent.width
              implicitHeight: recText.implicitHeight

              Column {
                id: recText
                anchors.left: parent.left
                anchors.right: recKeys.left
                anchors.rightMargin: Style.space(10)
                spacing: Style.space(1)

                PlainText {
                  width: parent.width
                  text: modelData.label
                  elide: Text.ElideRight
                  font.pixelSize: Style.font.bodySmall
                  font.bold: true
                }
                PlainText {
                  width: parent.width
                  text: root.recReason(modelData)
                  elide: Text.ElideRight
                  opacity: 0.6
                  font.pixelSize: Style.font.caption
                }
              }

              KeyChip {
                id: recKeys
                text: modelData.keys
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
              }
            }
          }
        }
      }
    }
  }

  component PlainText: Text {
    textFormat: Text.PlainText
    color: root.fg
    font.family: root.fontFamily
  }

  component KeyChip: Rectangle {
    property alias text: chipLabel.text
    implicitWidth: Math.min(chipLabel.implicitWidth, Style.space(170)) + Style.space(12)
    implicitHeight: chipLabel.implicitHeight + Style.space(4)
    width: implicitWidth
    height: implicitHeight
    radius: Style.cornerRadius > 0 ? Style.space(4) : 0
    color: Qt.rgba(root.fg.r, root.fg.g, root.fg.b, 0.08)
    border.width: 1
    border.color: Qt.rgba(root.fg.r, root.fg.g, root.fg.b, 0.18)

    Text {
      id: chipLabel
      anchors.centerIn: parent
      width: Math.min(implicitWidth, Style.space(170))
      textFormat: Text.PlainText
      elide: Text.ElideRight
      color: root.fg
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      font.bold: true
    }
  }
}
